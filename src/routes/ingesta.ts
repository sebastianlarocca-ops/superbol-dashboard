import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';

import { IngestionBatchModel } from '../models';
import { LedgerInput, ingest } from '../services/ingestion/IngestionService';
import { EMPRESAS, Empresa } from '../types/empresa';

/**
 * Endpoints for monthly batch ingestion.
 *
 *   POST /api/v1/ingesta            multipart upload (4 mayores + 1 inventory)
 *   GET  /api/v1/ingesta            list batches
 *   GET  /api/v1/ingesta/:id        single batch detail
 *
 * Multipart shape (POST): one field per file. Field names are explicit so we
 * never have to infer empresa from the filename:
 *   - inventory                 → required, the .xlsx with the INFORME tab
 *   - ledger_SUPERBOL           → optional, .xls/.xlsx mayor for SUPERBOL
 *   - ledger_PRUEBAS            → optional
 *   - ledger_SUSTEN             → optional
 *   - ledger_POINT              → optional
 * At least one ledger field must be present.
 *
 * Query params:
 *   - force=true                → delete the prior successful batch for the
 *                                 same period and reingest. Default false.
 */
const router = Router();

// Memory storage — files are small (<2 MB each in practice) and we parse
// directly from the buffer. No tmpdir cleanup needed.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB hard cap per file
    files: 5,
  },
});

const ledgerFields = EMPRESAS.map((e) => ({
  name: `ledger_${e}` as const,
  maxCount: 1,
}));

const uploadFields = upload.fields([{ name: 'inventory', maxCount: 1 }, ...ledgerFields]);

router.post(
  '/',
  uploadFields,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;

      const inventoryFile = files['inventory']?.[0];
      if (!inventoryFile) {
        res.status(400).json({ error: 'Falta el archivo "inventory" en el form-data' });
        return;
      }

      const ledgers: LedgerInput[] = [];
      for (const empresa of EMPRESAS) {
        const f = files[`ledger_${empresa}`]?.[0];
        if (f) {
          ledgers.push({
            empresa: empresa as Empresa,
            archivo: f.originalname,
            buffer: f.buffer,
          });
        }
      }
      if (ledgers.length === 0) {
        res.status(400).json({
          error:
            'Al menos un mayor es requerido. Campos válidos: ' +
            EMPRESAS.map((e) => `ledger_${e}`).join(', '),
        });
        return;
      }

      const force = req.query.force === 'true' || req.query.force === '1';

      const result = await ingest({
        ledgers,
        inventory: { archivo: inventoryFile.originalname, buffer: inventoryFile.buffer },
        force,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * Pre-flight check: does a successful batch already exist for the given
 * periodo? The UI calls this when the user picks a period so it can warn
 * before they pick files. Returns the existing batch's empresas + stats so
 * the UI can show "ya hay datos para este periodo" with detail.
 */
router.get('/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodo = (req.query.periodo as string | undefined)?.trim();
    if (!periodo || !/^\d{2}\/\d{4}$/.test(periodo)) {
      res.status(400).json({ error: 'Query "periodo" requerido en formato MM/YYYY' });
      return;
    }
    const batch = await IngestionBatchModel.findOne({ periodo, status: 'success' })
      .sort({ createdAt: -1 })
      .lean();
    if (!batch) {
      res.json({ exists: false, periodo });
      return;
    }
    res.json({
      exists: true,
      periodo,
      batchId: batch._id,
      status: batch.status,
      createdAt: batch.createdAt,
      files: batch.files,
      stats: batch.stats,
    });
  } catch (err) {
    next(err);
  }
});

/** List recent batches (most recent first). */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? '20', 10) || 20, 100);
    const batches = await IngestionBatchModel.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ count: batches.length, batches });
  } catch (err) {
    next(err);
  }
});

/** Single batch detail by id. */
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
