import { Router, Request, Response, NextFunction } from 'express';

import {
  IngestionBatchModel,
  InventoryItemModel,
  MovementModel,
} from '../models';
import { queryBalance, queryEvolucion, queryPnL } from '../services/reports/queries';
import { EMPRESAS, Empresa } from '../types/empresa';

/**
 * Read-only endpoints for the dashboard:
 *
 *   GET /api/v1/reports/pnl?periodo=MM/YYYY[&empresa=...][&includeAnulados=true]
 *   GET /api/v1/reports/balance?periodo=MM/YYYY[&empresa=...]
 *   GET /api/v1/reports/cmv?periodo=MM/YYYY
 *   GET /api/v1/reports/movements?periodo=...&...   (drill-down + paginado)
 *
 * Conventions across all endpoints:
 *   - `periodo` is required and must match `MM/YYYY`.
 *   - `empresa` is optional; when omitted, results are consolidated across
 *     the 4 entities.
 *   - Anulaciones are excluded from P&L by default (per Sebastián's flow:
 *     dueño retiros tagged as anuladas to keep them out of the P&L while
 *     preserving the data).
 *   - Cuentas Puentes (rubro "Cuentas puentes") are hidden from P&L —
 *     unclassified movs surface as warnings during ingestion, not as P&L
 *     line items.
 *   - `numeroCuenta`/`subrubro`/`rubro` filters always operate on the
 *     reimputed fields (post-enrichment), never on the raw ledger fields.
 */
const router = Router();

const PERIODO_RE = /^\d{2}\/\d{4}$/;

const parsePeriodo = (req: Request, res: Response): string | null => {
  const periodo = (req.query.periodo as string | undefined)?.trim();
  if (!periodo || !PERIODO_RE.test(periodo)) {
    res.status(400).json({ error: 'Query "periodo" requerido en formato MM/YYYY' });
    return null;
  }
  return periodo;
};

const parseEmpresa = (req: Request, res: Response): Empresa | undefined | null => {
  const raw = req.query.empresa as string | undefined;
  if (!raw) return undefined;
  if (!(EMPRESAS as readonly string[]).includes(raw)) {
    res.status(400).json({
      error: `Empresa "${raw}" inválida. Opciones: ${EMPRESAS.join(', ')}`,
    });
    return null; // sentinel: error already sent
  }
  return raw as Empresa;
};

// Enumerate all MM/YYYY periods between desde and hasta (inclusive).
// Uses numeric comparison so cross-year ranges work correctly.
function periodsInRange(desde: string, hasta: string): string[] {
  const [dm, dy] = desde.split('/').map(Number);
  const [hm, hy] = hasta.split('/').map(Number);
  const result: string[] = [];
  let m = dm, y = dy;
  while (y < hy || (y === hy && m <= hm)) {
    result.push(`${String(m).padStart(2, '0')}/${y}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return result;
}

// Parse period filter supporting both single `periodo` and range `periodoDesde`+`periodoHasta`.
// Returns null + sends 400 on failure (caller must return early).
function parsePeriodFilter(
  req: Request,
  res: Response,
): Record<string, unknown> | null {
  const single = (req.query.periodo as string | undefined)?.trim();
  const desde = (req.query.periodoDesde as string | undefined)?.trim();
  const hasta = (req.query.periodoHasta as string | undefined)?.trim();

  if (single) {
    if (!PERIODO_RE.test(single)) {
      res.status(400).json({ error: 'Query "periodo" inválido: usar formato MM/YYYY' });
      return null;
    }
    return { periodo: single };
  }

  if (desde && hasta) {
    if (!PERIODO_RE.test(desde) || !PERIODO_RE.test(hasta)) {
      res.status(400).json({ error: 'periodoDesde y periodoHasta deben ser MM/YYYY' });
      return null;
    }
    const periodos = periodsInRange(desde, hasta);
    if (periodos.length === 0) {
      res.status(400).json({ error: 'periodoDesde debe ser ≤ periodoHasta' });
      return null;
    }
    return { periodo: { $in: periodos } };
  }

  res.status(400).json({
    error: 'Requerido: "periodo" (MM/YYYY) o "periodoDesde"+"periodoHasta"',
  });
  return null;
}

// ─── /periodos ──────────────────────────────────────────────────────────────

/**
 * Lists all periods that have at least one successful batch. Used by the
 * frontend to populate the period selector. Sorted by createdAt desc so
 * the most recent period appears first.
 */
router.get('/periodos', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const batches = await IngestionBatchModel.find({ status: 'success' })
      .sort({ createdAt: -1 })
      .select('periodo createdAt stats kind')
      .lean();
    // Aggregate per periodo: sum movs across all batches (ledger + inventory
    // pseudo-movs), keep latest createdAt.
    const byPeriodo = new Map<string, { createdAt: Date; movs: number }>();
    for (const b of batches) {
      const cur = byPeriodo.get(b.periodo);
      const ts = b.createdAt as Date;
      const movs = b.stats?.movementsInserted ?? 0;
      if (!cur) {
        byPeriodo.set(b.periodo, { createdAt: ts, movs });
      } else {
        cur.movs += movs;
        if (ts > cur.createdAt) cur.createdAt = ts;
      }
    }
    const periodos = [...byPeriodo.entries()]
      .map(([periodo, v]) => ({
        periodo,
        createdAt: v.createdAt.toISOString(),
        movs: v.movs,
      }))
      .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    res.json({ count: periodos.length, periodos });
  } catch (err) {
    next(err);
  }
});

// ─── /evolucion ─────────────────────────────────────────────────────────────

/**
 * Multi-period series for the dashboard line chart and KPI deltas.
 * Returns one point per period that has a successful batch, sorted ASC.
 * Each point includes ventas, cmvAjustado, resultadoNeto, and subrubros
 * for ingresos/egresos to power the chart toggles.
 */
router.get('/evolucion', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await queryEvolucion();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── /pnl ───────────────────────────────────────────────────────────────────

router.get('/pnl', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodo = parsePeriodo(req, res);
    if (!periodo) return;
    const empresa = parseEmpresa(req, res);
    if (empresa === null) return;
    const includeAnulados =
      req.query.includeAnulados === 'true' || req.query.includeAnulados === '1';

    const result = await queryPnL({ periodo, empresa, includeAnulados });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── /balance ───────────────────────────────────────────────────────────────

router.get('/balance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodo = parsePeriodo(req, res);
    if (!periodo) return;
    const empresa = parseEmpresa(req, res);
    if (empresa === null) return;

    const result = await queryBalance({ periodo, empresa });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── /cmv ───────────────────────────────────────────────────────────────────

router.get('/cmv', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodo = parsePeriodo(req, res);
    if (!periodo) return;

    // CMV stats live on the inventory batch (recomputed on every change to
    // the period). Items live on InventoryItem.
    const batch = await IngestionBatchModel.findOne({
      periodo,
      kind: 'inventory',
      status: 'success',
    })
      .sort({ createdAt: -1 })
      .lean();
    if (!batch) {
      res.status(404).json({
        error: `No hay inventario cargado para período ${periodo}`,
      });
      return;
    }
    const items = await InventoryItemModel.find({ ingestionBatchId: batch._id })
      .sort({ costoFinanciero: -1 })
      .lean();

    // Top movers by absolute cf (5 each direction)
    const sortedByCf = [...items].sort(
      (a, b) => Math.abs(b.costoFinanciero) - Math.abs(a.costoFinanciero),
    );
    const topGanancias = sortedByCf.filter((i) => i.costoFinanciero > 0).slice(0, 5);
    const topPerdidas = [...items]
      .filter((i) => i.costoFinanciero < 0)
      .sort((a, b) => a.costoFinanciero - b.costoFinanciero)
      .slice(0, 5);

    const stats = batch.stats!;
    res.json({
      periodo,
      batchId: batch._id,
      totals: {
        stockInicial: stats.stockInicial,
        compras: stats.compras,
        stockFinal: stats.stockFinal,
        cmvBruto: stats.cmvBruto,
        costoFinanciero: stats.costoFinanciero,
        cmvAjustado: stats.cmvAjustado,
      },
      items,
      topGanancias,
      topPerdidas,
    });
  } catch (err) {
    next(err);
  }
});

// ─── /movements/distinct/* (column filter values) ───────────────────────────

// Returns distinct (numeroCuentaReimputada, nombreCuentaReimputada) pairs for
// the column filter dropdown. Accepts single periodo or periodoDesde+periodoHasta.
router.get('/movements/distinct/cuenta', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodFilter = parsePeriodFilter(req, res);
    if (!periodFilter) return;

    const values = await MovementModel.aggregate<{ numero: string; nombre: string }>([
      { $match: periodFilter },
      { $group: { _id: '$numeroCuentaReimputada', nombre: { $first: '$nombreCuentaReimputada' } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, numero: '$_id', nombre: 1 } },
    ]);

    res.json({ values });
  } catch (err) {
    next(err);
  }
});

// Returns distinct nombreSubcuenta values (nulls excluded).
router.get('/movements/distinct/subcuenta', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodFilter = parsePeriodFilter(req, res);
    if (!periodFilter) return;

    const values = (
      await MovementModel.distinct('nombreSubcuenta', {
        ...periodFilter,
        nombreSubcuenta: { $ne: null },
      })
    ).sort() as string[];

    res.json({ values });
  } catch (err) {
    next(err);
  }
});

// ─── /movements (drill-down + full ledger browser) ──────────────────────────
//
// Supports two period modes:
//   - Single: ?periodo=MM/YYYY          (used by MovementsModal)
//   - Range:  ?periodoDesde=MM/YYYY&periodoHasta=MM/YYYY  (used by MovimientosPage)
//
// Column filters (all optional, multi-value via comma-separated):
//   cuentas=6200,7900        → numeroCuentaReimputada $in (new multi-select)
//   subcuentas=Sub A,Sub B   → nombreSubcuenta $in
//   detalle=texto            → case-insensitive regex contains
//   numeroCuentaReimputada   → legacy single-value (backward compat for modal)
//   subrubro / rubroReimputada / sourceType / anulacion → unchanged

router.get('/movements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodFilter = parsePeriodFilter(req, res);
    if (!periodFilter) return;
    const empresa = parseEmpresa(req, res);
    if (empresa === null) return;

    const limit = Math.min(parseInt((req.query.limit as string) ?? '500', 10) || 500, 5000);
    const offset = Math.max(parseInt((req.query.offset as string) ?? '0', 10) || 0, 0);

    const filter: Record<string, unknown> = { ...periodFilter };
    if (empresa) filter.empresa = empresa;

    // Cuenta filter: multi-value (new) or single legacy
    const cuentasParam = (req.query.cuentas as string | undefined)?.trim();
    if (cuentasParam) {
      const vals = cuentasParam.split(',').map((s) => s.trim()).filter(Boolean);
      filter.numeroCuentaReimputada = vals.length === 1 ? vals[0] : { $in: vals };
    } else if (req.query.numeroCuentaReimputada) {
      filter.numeroCuentaReimputada = req.query.numeroCuentaReimputada;
    }

    // Subcuenta filter: multi-value nombreSubcuenta
    const subcuentasParam = (req.query.subcuentas as string | undefined)?.trim();
    if (subcuentasParam) {
      const vals = subcuentasParam.split(',').map((s) => s.trim()).filter(Boolean);
      filter.nombreSubcuenta = vals.length === 1 ? vals[0] : { $in: vals };
    } else if (req.query.subrubro) {
      filter.subrubro = req.query.subrubro;
    }

    // Detalle contains (case-insensitive)
    if (req.query.detalle) {
      const escaped = (req.query.detalle as string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.detalle = { $regex: escaped, $options: 'i' };
    }

    if (req.query.rubroReimputada) filter.rubroReimputada = req.query.rubroReimputada;
    if (req.query.sourceType) filter.sourceType = req.query.sourceType;
    if (req.query.anulacion === 'true') filter.anulacion = true;
    else if (req.query.anulacion === 'false') filter.anulacion = false;

    const [aggResult, movements] = await Promise.all([
      MovementModel.aggregate<{ _id: null; total: number; totalDebe: number; totalHaber: number }>([
        { $match: filter },
        { $group: { _id: null, total: { $sum: 1 }, totalDebe: { $sum: '$debe' }, totalHaber: { $sum: '$haber' } } },
      ]),
      MovementModel.find(filter)
        .sort({ fechaISO: 1, asiento: 1 })
        .skip(offset)
        .limit(limit)
        .lean(),
    ]);

    const agg = aggResult[0] ?? { total: 0, totalDebe: 0, totalHaber: 0 };

    res.json({
      empresa: empresa ?? null,
      total: agg.total,
      offset,
      limit,
      count: movements.length,
      totals: {
        debe: agg.totalDebe,
        haber: agg.totalHaber,
        saldo: agg.totalHaber - agg.totalDebe,
      },
      movements,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
