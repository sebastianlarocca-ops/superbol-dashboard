import { createHash } from 'crypto';
import { Types } from 'mongoose';

import { MovementModel } from '../../models';
import { PayrollBatchModel } from '../../models/PayrollBatch';
import { PayrollRecordModel } from '../../models/PayrollRecord';
import { classifyRubro } from '../../types/empresa';
import { parsePayroll, detectPeriodoFromFilename } from './PayrollParser';

// Cuenta virtual para costo de nómina — Resultado negativo (6xxx).
const CUENTA_NOMINA = { numero: '6300', nombre: 'Costo Laboral' };
const SUBRUBRO_NOMINA = 'Nómina';

const lastDayOfPeriodUTC = (periodo: string): Date => {
  const [mm, yyyy] = periodo.split('/').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(yyyy, mm, 0));
};

export type PayrollIngestionInput = {
  archivo: string;
  buffer: Buffer;
  /** MM/YYYY — if omitted, inferred from the filename. */
  periodo?: string;
  /** If true, delete the existing successful batch for the period and re-ingest. */
  force?: boolean;
};

export type PayrollConflictError = {
  status: 409;
  message: string;
  periodo: string;
  existingBatchId: string;
};

export type PayrollIngestionResult = {
  periodo: string;
  batchId: string;
  recordCount: number;
  totalCost: number;
  pseudoMovementsInserted: number;
  warnings: string[];
};

/**
 * Orchestrates payroll ingestion:
 *   1. Detect periodo (from filename or explicit param).
 *   2. Idempotency check — reject with 409 if a successful batch exists (unless force=true).
 *   3. Parse the Excel file into normalized PayrollRecord rows.
 *   4. Persist PayrollBatch + PayrollRecord documents.
 *   5. Generate one pseudo-movement per sector (sourceType='payroll') and persist
 *      them into the `movements` collection so the P&L picks them up.
 */
export const ingestPayroll = async (
  input: PayrollIngestionInput,
): Promise<PayrollIngestionResult> => {
  const { archivo, buffer, force = false } = input;

  // ── Resolve periodo ──────────────────────────────────────────────────────────
  let periodo = input.periodo?.trim();
  if (!periodo) {
    periodo = detectPeriodoFromFilename(archivo) ?? undefined;
  }
  if (!periodo || !/^\d{2}\/\d{4}$/.test(periodo)) {
    throw new Error(
      'No se pudo determinar el período del archivo. ' +
        'Envíe el parámetro "periodo" en formato MM/YYYY o nombre el archivo con el patrón MM-YYYY.',
    );
  }

  // ── Idempotency check ────────────────────────────────────────────────────────
  const existing = await PayrollBatchModel.findOne({
    periodo,
    status: 'success',
  }).lean();

  if (existing) {
    if (!force) {
      const err: PayrollConflictError = {
        status: 409,
        message: `Ya existe una nómina cargada para el período ${periodo}.`,
        periodo,
        existingBatchId: existing._id.toString(),
      };
      throw err;
    }
    // force=true: delete prior batch, its records, and its pseudo-movements
    await Promise.all([
      PayrollRecordModel.deleteMany({ payrollBatchId: existing._id }),
      MovementModel.deleteMany({ periodo, sourceType: 'payroll' }),
      PayrollBatchModel.deleteOne({ _id: existing._id }),
    ]);
  }

  // ── Create batch (processing) ────────────────────────────────────────────────
  const hash = createHash('sha256').update(buffer).digest('hex');
  const batch = await PayrollBatchModel.create({
    periodo,
    file: { name: archivo, hash },
    status: 'processing',
  });
  const batchId = batch._id as Types.ObjectId;

  try {
    // ── Parse ────────────────────────────────────────────────────────────────
    const { records, warnings } = parsePayroll(buffer);

    if (records.length === 0) {
      throw new Error('El archivo no produjo ningún registro de nómina parseable.');
    }

    // ── Insert PayrollRecords ────────────────────────────────────────────────
    const recordDocs = records.map((r) => ({
      payrollBatchId: batchId,
      periodo,
      ...r,
    }));
    await PayrollRecordModel.insertMany(recordDocs, { ordered: false });

    // ── Build pseudo-movements (one per sector) ──────────────────────────────
    const fecha = lastDayOfPeriodUTC(periodo);
    const rubro = classifyRubro(CUENTA_NOMINA.numero); // 'Resultado negativo'

    // Aggregate total cost per sector (exclude BAJA employees from the P&L movement)
    const sectorTotals = new Map<string, number>();
    for (const r of records) {
      if (r.esBaja) continue;
      const prev = sectorTotals.get(r.sector) ?? 0;
      sectorTotals.set(r.sector, prev + r.totalSueldoMasCargas);
    }

    const pseudoMovDocs = [...sectorTotals.entries()]
      .filter(([, total]) => total > 0)
      .map(([sector, total]) => ({
        empresa: 'SUPERBOL' as const,
        periodo,
        fechaISO: fecha,
        archivo,
        ingestionBatchId: batchId,
        sourceType: 'payroll' as const,
        asiento: 0,
        numeroCuenta: CUENTA_NOMINA.numero,
        nombreCuenta: CUENTA_NOMINA.nombre,
        numeroSubcuenta: null,
        nombreSubcuenta: sector,
        rubro,
        detalle: `Costo Nómina ${sector} ${periodo}`,
        debe: 0,
        haber: total,
        numeroCuentaReimputada: CUENTA_NOMINA.numero,
        nombreCuentaReimputada: CUENTA_NOMINA.nombre,
        rubroReimputada: rubro,
        subrubro: SUBRUBRO_NOMINA,
        anulacion: false,
      }));

    await MovementModel.insertMany(pseudoMovDocs, { ordered: false });

    const totalCost = records
      .filter((r) => !r.esBaja)
      .reduce((s, r) => s + r.totalSueldoMasCargas, 0);

    // ── Mark success ─────────────────────────────────────────────────────────
    await PayrollBatchModel.findByIdAndUpdate(batchId, {
      status: 'success',
      stats: {
        recordCount: records.length,
        totalCost,
        pseudoMovementsInserted: pseudoMovDocs.length,
      },
      errors: warnings,
    });

    return {
      periodo,
      batchId: batchId.toString(),
      recordCount: records.length,
      totalCost,
      pseudoMovementsInserted: pseudoMovDocs.length,
      warnings,
    };
  } catch (err) {
    await PayrollBatchModel.findByIdAndUpdate(batchId, {
      status: 'failed',
      errors: [err instanceof Error ? err.message : String(err)],
    });
    throw err;
  }
};
