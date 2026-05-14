import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';

import { PayrollBatchModel } from '../models/PayrollBatch';
import { PayrollRecordModel } from '../models/PayrollRecord';
import { MovementModel } from '../models';
import {
  ingestPayroll,
  PayrollConflictError,
} from '../services/payroll/PayrollIngestionService';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

// ── POST / ───────────────────────────────────────────────────────────────────
/**
 * Upload and ingest a payroll Excel file.
 *
 *   Field: nomina (multipart file, .xlsx)
 *   Body:  periodo  (optional, MM/YYYY — inferred from filename if omitted)
 *   Query: force=true (delete existing batch for the period and re-ingest)
 */
router.post(
  '/',
  upload.single('nomina'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Debe enviarse el archivo en el campo "nomina".' });
        return;
      }

      const force = req.query.force === 'true' || req.query.force === '1';
      const periodo = (req.body?.periodo as string | undefined)?.trim() || undefined;

      try {
        const result = await ingestPayroll({
          archivo: file.originalname,
          buffer: file.buffer,
          periodo,
          force,
        });
        res.status(201).json(result);
      } catch (err) {
        if (err && typeof err === 'object' && (err as PayrollConflictError).status === 409) {
          const cErr = err as PayrollConflictError;
          res.status(409).json({
            error: cErr.message,
            periodo: cErr.periodo,
            existingBatchId: cErr.existingBatchId,
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

// ── GET / ─────────────────────────────────────────────────────────────────────
/**
 * List successful payroll batches, most recent first.
 * Optional query: limit (default 50, max 200)
 */
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10) || 50, 200);
    const batches = await PayrollBatchModel.find({ status: 'success' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ count: batches.length, batches });
  } catch (err) {
    next(err);
  }
});

// ── GET /check ────────────────────────────────────────────────────────────────
/**
 * Pre-flight: is there already a payroll batch for this period?
 * Query: periodo (MM/YYYY, required)
 */
router.get('/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodo = (req.query.periodo as string | undefined)?.trim();
    if (!periodo || !/^\d{2}\/\d{4}$/.test(periodo)) {
      res.status(400).json({ error: 'Query "periodo" requerido en formato MM/YYYY' });
      return;
    }
    const batch = await PayrollBatchModel.findOne({ periodo, status: 'success' }).lean();
    res.json({
      periodo,
      loaded: !!batch,
      batch: batch ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /records ──────────────────────────────────────────────────────────────
/**
 * Fetch payroll records for a period.
 * Query: periodo (MM/YYYY, required), sector (optional), esBaja (optional, boolean)
 */
router.get('/records', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const periodo = (req.query.periodo as string | undefined)?.trim();
    if (!periodo || !/^\d{2}\/\d{4}$/.test(periodo)) {
      res.status(400).json({ error: 'Query "periodo" requerido en formato MM/YYYY' });
      return;
    }

    const filter: Record<string, unknown> = { periodo };
    if (req.query.sector) filter.sector = req.query.sector;
    if (req.query.esBaja !== undefined) filter.esBaja = req.query.esBaja === 'true';

    const records = await PayrollRecordModel.find(filter)
      .sort({ sector: 1, nomina: 1 })
      .lean();

    const totalCost = records
      .filter((r) => !r.esBaja)
      .reduce((s, r) => s + r.totalSueldoMasCargas, 0);

    res.json({ count: records.length, totalCost, records });
  } catch (err) {
    next(err);
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const batch = await PayrollBatchModel.findById(req.params.id).lean();
    if (!batch) {
      res.status(404).json({ error: 'Batch de nómina no encontrado' });
      return;
    }
    res.json(batch);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────
/**
 * Delete a payroll batch and all its records + pseudo-movements.
 * This allows re-uploading a corrected file without using force=true.
 */
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const batch = await PayrollBatchModel.findById(req.params.id).lean();
    if (!batch) {
      res.status(404).json({ error: 'Batch de nómina no encontrado' });
      return;
    }

    await Promise.all([
      PayrollRecordModel.deleteMany({ payrollBatchId: batch._id }),
      MovementModel.deleteMany({ periodo: batch.periodo, sourceType: 'payroll' }),
      PayrollBatchModel.deleteOne({ _id: batch._id }),
    ]);

    res.json({ deleted: true, periodo: batch.periodo });
  } catch (err) {
    next(err);
  }
});

export default router;
