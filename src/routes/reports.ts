import { Router, Request, Response, NextFunction } from 'express';

import {
  IngestionBatchModel,
  InventoryItemModel,
  MovementModel,
} from '../models';
import { queryBalance, queryPnL } from '../services/reports/queries';
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

    // Stats live on the IngestionBatch (computed at ingest-time, no aggregation
    // needed). Items live on InventoryItem.
    const batch = await IngestionBatchModel.findOne({ periodo, status: 'success' })
      .sort({ createdAt: -1 })
      .lean();
    if (!batch) {
      res.status(404).json({ error: `No hay batch exitoso para período ${periodo}` });
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

// ─── /movements (drill-down) ────────────────────────────────────────────────

router.get('/movements', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodo = parsePeriodo(req, res);
    if (!periodo) return;
    const empresa = parseEmpresa(req, res);
    if (empresa === null) return;

    const limit = Math.min(parseInt((req.query.limit as string) ?? '200', 10) || 200, 1000);
    const offset = Math.max(parseInt((req.query.offset as string) ?? '0', 10) || 0, 0);

    const filter: Record<string, unknown> = { periodo };
    if (empresa) filter.empresa = empresa;
    if (req.query.numeroCuentaReimputada)
      filter.numeroCuentaReimputada = req.query.numeroCuentaReimputada;
    if (req.query.subrubro) filter.subrubro = req.query.subrubro;
    if (req.query.rubroReimputada) filter.rubroReimputada = req.query.rubroReimputada;
    if (req.query.sourceType) filter.sourceType = req.query.sourceType;

    // Anulación filter: explicit boolean, since by default we'd want to show
    // ALL movements in a drill-down (the user came here to see everything).
    if (req.query.anulacion === 'true') filter.anulacion = true;
    else if (req.query.anulacion === 'false') filter.anulacion = false;

    const [total, movements] = await Promise.all([
      MovementModel.countDocuments(filter),
      MovementModel.find(filter)
        .sort({ fechaISO: 1, asiento: 1 })
        .skip(offset)
        .limit(limit)
        .lean(),
    ]);

    res.json({
      periodo,
      empresa: empresa ?? null,
      total,
      offset,
      limit,
      count: movements.length,
      movements,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
