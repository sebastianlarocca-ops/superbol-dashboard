import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as XLSX from 'xlsx';

import { IngestionBatch, IngestionBatchModel } from '../models';
import {
  ConflictError,
  LedgerInput,
  ingest,
} from '../services/ingestion/IngestionService';
import { EMPRESAS, Empresa } from '../types/empresa';

// ── File sniff utility ───────────────────────────────────────────────────────

type SniffResult = {
  filename: string;
  type: 'inventory' | 'ledger' | 'unknown';
  empresa: Empresa | null;
  periodo: string | null;
  size: number;
  error?: string;
};

/**
 * Lightweight probe of an Excel buffer to detect file type, empresa, and period
 * without running the full parser. Used by the /sniff endpoint so the UI can
 * show a confirmation table before the actual ingesta.
 *
 * Detection logic:
 *   - Has an "INFORME" sheet → inventory (no empresa/periodo)
 *   - Otherwise → ledger; scan first 20 rows for an EMPRESAS name; scan rows
 *     15+ for the first valid Date cell to infer periodo.
 */
function sniffFile(buffer: Buffer, filename: string, size: number): SniffResult {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

    if (wb.SheetNames.some((s) => s.trim().toUpperCase() === 'INFORME')) {
      return { filename, type: 'inventory', empresa: null, periodo: null, size };
    }

    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return { filename, type: 'unknown', empresa: null, periodo: null, size };

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });

    let empresa: Empresa | null = null;
    for (let i = 0; i < Math.min(20, rows.length) && !empresa; i++) {
      for (const cell of rows[i]) {
        if (typeof cell !== 'string') continue;
        const upper = cell.toUpperCase();
        for (const e of EMPRESAS) {
          if (upper.includes(e)) { empresa = e; break; }
        }
        if (empresa) break;
      }
    }

    let periodo: string | null = null;
    for (let i = 15; i < rows.length && !periodo; i++) {
      for (const cell of rows[i]) {
        if (cell instanceof Date && !isNaN(cell.getTime())) {
          const yyyy = cell.getUTCFullYear();
          if (yyyy >= 2020 && yyyy <= 2040) {
            periodo = `${String(cell.getUTCMonth() + 1).padStart(2, '0')}/${yyyy}`;
            break;
          }
        }
      }
    }

    return { filename, type: 'ledger', empresa, periodo, size };
  } catch (err) {
    return {
      filename, type: 'unknown', empresa: null, periodo: null, size,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Endpoints for ingestion.
 *
 *   POST /api/v1/ingesta            multipart upload (1+ ledgers + 0..1 inventory)
 *   POST /api/v1/ingesta/sniff      probe files (no DB writes)
 *   GET  /api/v1/ingesta/check      what's loaded for a period (per-empresa)
 *   GET  /api/v1/ingesta            grouped-by-periodo batch list
 *   GET  /api/v1/ingesta/:id        single batch detail
 *
 * Multipart shape (POST): one field per file. Field names are explicit so we
 * never have to infer empresa from the filename:
 *   - inventory                 → optional, the .xlsx with the INFORME tab
 *   - ledger_SUPERBOL           → optional, .xls/.xlsx mayor for SUPERBOL
 *   - ledger_PRUEBAS            → optional
 *   - ledger_SUSTEN             → optional
 *   - ledger_POINT              → optional
 *   - periodo (text field)      → optional MM/YYYY (required for inventory-only)
 * At least one file (ledger or inventory) must be present.
 *
 * Query params:
 *   - force=true                → delete only the conflicting batches (same
 *                                 kind+empresa for the period) and reingest.
 *                                 Other empresas in the period are untouched.
 */
const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
    files: 10,
  },
});

const ledgerFields = EMPRESAS.map((e) => ({ name: `ledger_${e}` as const, maxCount: 1 }));
const uploadFields = upload.fields([{ name: 'inventory', maxCount: 1 }, ...ledgerFields]);

// ── POST /sniff ──────────────────────────────────────────────────────────────
router.post(
  '/sniff',
  upload.array('files', 10),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = (req.files ?? []) as Express.Multer.File[];
      if (!files.length) {
        res.status(400).json({ error: 'No se recibieron archivos' });
        return;
      }
      const results: SniffResult[] = files.map((f) =>
        sniffFile(f.buffer, f.originalname, f.size),
      );
      res.json({ results });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST / (main ingesta) ────────────────────────────────────────────────────
router.post(
  '/',
  uploadFields,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;

      const inventoryFile = files['inventory']?.[0];

      const ledgers: LedgerInput[] = [];
      for (const empresa of EMPRESAS) {
        const f = files[`ledger_${empresa}`]?.[0];
        if (f) {
          ledgers.push({ empresa: empresa as Empresa, archivo: f.originalname, buffer: f.buffer });
        }
      }
      if (ledgers.length === 0 && !inventoryFile) {
        res.status(400).json({
          error: 'Debe enviarse al menos un mayor o un inventario. ' +
            'Campos válidos: inventory, ' +
            EMPRESAS.map((e) => `ledger_${e}`).join(', '),
        });
        return;
      }

      const force = req.query.force === 'true' || req.query.force === '1';
      const periodo = (req.body?.periodo as string | undefined)?.trim() || undefined;

      try {
        const result = await ingest({
          ledgers,
          inventory: inventoryFile
            ? { archivo: inventoryFile.originalname, buffer: inventoryFile.buffer }
            : undefined,
          periodo,
          force,
        });
        res.status(201).json(result);
      } catch (err) {
        // Conflict errors carry structured data so the UI can list them.
        if (err && typeof err === 'object' && (err as ConflictError).status === 409) {
          const cErr = err as ConflictError;
          res.status(409).json({
            error: cErr.message,
            periodo: cErr.periodo,
            conflicts: cErr.conflicts,
          });
          return;
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

// ── GET /check ───────────────────────────────────────────────────────────────
/**
 * Pre-flight: what's already loaded for a given periodo? Used by the UI to
 * compute per-empresa conflicts before submission.
 */
router.get('/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodo = (req.query.periodo as string | undefined)?.trim();
    if (!periodo || !/^\d{2}\/\d{4}$/.test(periodo)) {
      res.status(400).json({ error: 'Query "periodo" requerido en formato MM/YYYY' });
      return;
    }
    const batches = await IngestionBatchModel.find({ periodo, status: 'success' })
      .sort({ createdAt: -1 })
      .lean<IngestionBatch[]>();

    const ledgers = batches
      .filter((b) => b.kind === 'ledger' && b.empresa)
      .map((b) => ({
        empresa: b.empresa as Empresa,
        batchId: b._id.toString(),
        createdAt: b.createdAt,
        rowsProcessed: b.file.rowsProcessed,
      }));
    const inv = batches.find((b) => b.kind === 'inventory') ?? null;

    res.json({
      periodo,
      ledgers,
      inventory: inv
        ? {
            batchId: inv._id.toString(),
            createdAt: inv.createdAt,
            rowsProcessed: inv.file.rowsProcessed,
            stats: inv.stats,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET / (list, grouped by periodo) ─────────────────────────────────────────
/**
 * Lists successful batches grouped by periodo. One periodo entry per row in
 * the UI's "Períodos cargados" table.
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10) || 50, 200);
    const batches = await IngestionBatchModel.find({ status: 'success' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<IngestionBatch[]>();

    type Group = {
      periodo: string;
      ledgers: {
        empresa: Empresa;
        batchId: string;
        createdAt: Date | undefined;
        rowsProcessed: number;
      }[];
      inventory: {
        batchId: string;
        createdAt: Date | undefined;
        rowsProcessed: number;
      } | null;
      // Sum of movs across this period's ledger batches + the inventory batch
      // (if present, its `movementsInserted` reflects pseudo-mov count).
      totalMovements: number;
      cmvAjustado: number;
      lastUpdated: Date | undefined;
    };

    const groupMap = new Map<string, Group>();
    for (const b of batches) {
      const g = groupMap.get(b.periodo) ?? {
        periodo: b.periodo,
        ledgers: [],
        inventory: null,
        totalMovements: 0,
        cmvAjustado: 0,
        lastUpdated: undefined,
      };
      if (b.kind === 'ledger' && b.empresa) {
        g.ledgers.push({
          empresa: b.empresa,
          batchId: b._id.toString(),
          createdAt: b.createdAt,
          rowsProcessed: b.file.rowsProcessed,
        });
        g.totalMovements += b.stats?.movementsInserted ?? 0;
      } else if (b.kind === 'inventory') {
        g.inventory = {
          batchId: b._id.toString(),
          createdAt: b.createdAt,
          rowsProcessed: b.file.rowsProcessed,
        };
        g.totalMovements += b.stats?.movementsInserted ?? 0;
        g.cmvAjustado = b.stats?.cmvAjustado ?? 0;
      }
      const ts = b.updatedAt ?? b.createdAt;
      if (ts && (!g.lastUpdated || ts > g.lastUpdated)) g.lastUpdated = ts;
      groupMap.set(b.periodo, g);
    }

    // Sort empresas alphabetically inside each group for stable display.
    const groups = [...groupMap.values()];
    for (const g of groups) g.ledgers.sort((a, b) => a.empresa.localeCompare(b.empresa));
    // Sort groups by lastUpdated desc.
    groups.sort((a, b) => {
      const at = a.lastUpdated?.getTime() ?? 0;
      const bt = b.lastUpdated?.getTime() ?? 0;
      return bt - at;
    });

    res.json({ count: groups.length, periodos: groups });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id ─────────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const batch = await IngestionBatchModel.findById(req.params.id).lean();
    if (!batch) {
      res.status(404).json({ error: 'Batch no encontrado' });
      return;
    }
    res.json(batch);
  } catch (err) {
    next(err);
  }
});

export default router;
