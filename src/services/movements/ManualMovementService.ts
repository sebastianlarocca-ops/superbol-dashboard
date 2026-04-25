import {
  Movement,
  MovementModel,
  SubrubroMap,
  SubrubroMapModel,
} from '../../models';
import { Empresa, Rubro, classifyRubro } from '../../types/empresa';

export type ManualMovementInput = {
  empresa: Empresa;
  periodo: string; // MM/YYYY
  fechaISO: Date | string; // accept ISO string from JSON requests
  numeroCuenta: string;
  nombreCuenta: string;
  numeroSubcuenta?: string | null;
  nombreSubcuenta?: string | null;
  detalle?: string;
  debe?: number;
  haber?: number;
};

export type ManualMovementUpdateInput = Partial<ManualMovementInput>;

export type ManualMovementCreated = {
  movement: Movement;
  warnings: string[];
};

const PERIODO_RE = /^\d{2}\/\d{4}$/;
const VALID_PNL_BAL_RUBROS: Rubro[] = [
  'Activo',
  'Pasivo',
  'Resultado positivo',
  'Resultado negativo',
];

const httpError = (status: number, message: string): Error & { status: number } => {
  const e = new Error(message) as Error & { status: number };
  e.status = status;
  return e;
};

/** Validates and normalizes the input, throws on failure. */
const validate = (input: ManualMovementInput): void => {
  if (!input.empresa) throw httpError(400, 'empresa es requerido');
  if (!input.periodo || !PERIODO_RE.test(input.periodo)) {
    throw httpError(400, 'periodo es requerido en formato MM/YYYY');
  }
  if (!input.fechaISO) throw httpError(400, 'fechaISO es requerido');
  if (!input.numeroCuenta?.trim()) throw httpError(400, 'numeroCuenta es requerido');
  if (!input.nombreCuenta?.trim()) throw httpError(400, 'nombreCuenta es requerido');

  const debe = input.debe ?? 0;
  const haber = input.haber ?? 0;
  if (debe < 0 || haber < 0) {
    throw httpError(400, 'debe y haber no pueden ser negativos');
  }
  if (debe === 0 && haber === 0) {
    throw httpError(400, 'Indicar monto en debe o haber (uno > 0)');
  }
  if (debe > 0 && haber > 0) {
    throw httpError(400, 'No se permite cargar debe Y haber en el mismo movimiento');
  }

  // Verify the cuenta number resolves to a real rubro (not Cuentas puentes).
  const rubro = classifyRubro(input.numeroCuenta);
  if (!VALID_PNL_BAL_RUBROS.includes(rubro)) {
    throw httpError(
      400,
      `El número de cuenta "${input.numeroCuenta}" no clasifica a Activo/Pasivo/Resultado. ` +
        `Verificá el número (debe estar en rangos 1000-2999, 3000-3999, 6000-6999, 7000-7999 o ` +
        `tener override).`,
    );
  }

  // Verify fechaISO is parseable + falls inside the periodo's month
  const d = input.fechaISO instanceof Date ? input.fechaISO : new Date(input.fechaISO);
  if (isNaN(d.getTime())) throw httpError(400, 'fechaISO no es una fecha válida');
  const [mm, yyyy] = input.periodo.split('/').map((s) => parseInt(s, 10));
  if (d.getUTCMonth() + 1 !== mm || d.getUTCFullYear() !== yyyy) {
    throw httpError(
      400,
      `La fecha ${d.toISOString().slice(0, 10)} no pertenece al período ${input.periodo}`,
    );
  }
};

/**
 * Lookup the subrubro by exact (case-insensitive) name match. Mirrors the
 * SubrubroEnricher used in the ledger pipeline. Returns null if no match.
 */
const lookupSubrubro = async (nombreCuenta: string): Promise<string | null> => {
  const all = await SubrubroMapModel.find().lean<SubrubroMap[]>();
  const key = nombreCuenta.trim().toLowerCase();
  for (const m of all) {
    if (m.nombreCuentaReimputada.trim().toLowerCase() === key) return m.nombreSubrubro;
  }
  return null;
};

/**
 * Create one manual movement. The user supplies the FINAL classification
 * (cuenta + subcuenta) — we don't re-run reimputation. Auto-fills:
 *   - rubro / rubroReimputada via classifyRubro(numeroCuenta)
 *   - numeroCuentaReimputada / nombreCuentaReimputada = same as input
 *   - subrubro via SubrubroMap lookup (case-insensitive)
 *   - sourceType = 'manual', archivo = '(manual)', asiento = 0,
 *     ingestionBatchId = null
 *
 * Returns the created movement plus an array of warnings (e.g. "subrubro
 * no asignado"). Warnings are non-fatal — the doc is created either way.
 */
export const createManualMovement = async (
  input: ManualMovementInput,
): Promise<ManualMovementCreated> => {
  validate(input);

  const rubro = classifyRubro(input.numeroCuenta);
  const fecha = input.fechaISO instanceof Date ? input.fechaISO : new Date(input.fechaISO);
  const subrubro = await lookupSubrubro(input.nombreCuenta);
  const isPnL = rubro === 'Resultado positivo' || rubro === 'Resultado negativo';

  const warnings: string[] = [];
  if (isPnL && !subrubro) {
    warnings.push(
      `Cuenta "${input.nombreCuenta}" sin subrubro asignado. ` +
        `Agregá un mapeo en /api/v1/rules/subrubros para que aparezca agrupada en el P&L.`,
    );
  }

  const doc = await MovementModel.create({
    empresa: input.empresa,
    periodo: input.periodo,
    fechaISO: fecha,
    archivo: '(manual)',
    ingestionBatchId: null,
    sourceType: 'manual',
    asiento: 0,
    numeroCuenta: input.numeroCuenta.trim(),
    nombreCuenta: input.nombreCuenta.trim(),
    numeroSubcuenta: input.numeroSubcuenta?.trim() || null,
    nombreSubcuenta: input.nombreSubcuenta?.trim() || null,
    rubro,
    detalle: input.detalle?.trim() ?? '',
    debe: input.debe ?? 0,
    haber: input.haber ?? 0,
    numeroCuentaReimputada: input.numeroCuenta.trim(),
    nombreCuentaReimputada: input.nombreCuenta.trim(),
    rubroReimputada: rubro,
    subrubro,
    anulacion: false,
  });

  return { movement: doc.toObject() as unknown as Movement, warnings };
};

/** List manual movements for a period (and optionally an empresa). */
export const listManualMovements = async (
  periodo: string,
  empresa?: Empresa,
): Promise<Movement[]> => {
  if (!PERIODO_RE.test(periodo)) {
    throw httpError(400, 'periodo en formato MM/YYYY requerido');
  }
  const filter: Record<string, unknown> = { periodo, sourceType: 'manual' };
  if (empresa) filter.empresa = empresa;
  return MovementModel.find(filter).sort({ fechaISO: 1, createdAt: 1 }).lean<Movement[]>();
};

/**
 * Patch a manual movement. Re-validates the resulting document so we never
 * leave a half-cooked entry in the DB. Recomputes rubro and subrubro from
 * the merged input (so changing the numeroCuenta updates the rubro).
 */
export const updateManualMovement = async (
  id: string,
  patch: ManualMovementUpdateInput,
): Promise<ManualMovementCreated> => {
  const existing = await MovementModel.findById(id).lean<Movement | null>();
  if (!existing) throw httpError(404, 'Movimiento no encontrado');
  if (existing.sourceType !== 'manual') {
    throw httpError(400, 'Solo se pueden editar movimientos manuales');
  }

  const merged: ManualMovementInput = {
    empresa: patch.empresa ?? existing.empresa,
    periodo: patch.periodo ?? existing.periodo,
    fechaISO: patch.fechaISO ?? existing.fechaISO,
    numeroCuenta: patch.numeroCuenta ?? existing.numeroCuenta,
    nombreCuenta: patch.nombreCuenta ?? existing.nombreCuenta,
    numeroSubcuenta:
      patch.numeroSubcuenta !== undefined ? patch.numeroSubcuenta : existing.numeroSubcuenta,
    nombreSubcuenta:
      patch.nombreSubcuenta !== undefined ? patch.nombreSubcuenta : existing.nombreSubcuenta,
    detalle: patch.detalle ?? existing.detalle,
    debe: patch.debe ?? existing.debe,
    haber: patch.haber ?? existing.haber,
  };
  validate(merged);

  const rubro = classifyRubro(merged.numeroCuenta);
  const subrubro = await lookupSubrubro(merged.nombreCuenta);
  const fecha = merged.fechaISO instanceof Date ? merged.fechaISO : new Date(merged.fechaISO);
  const isPnL = rubro === 'Resultado positivo' || rubro === 'Resultado negativo';

  const warnings: string[] = [];
  if (isPnL && !subrubro) {
    warnings.push(`Cuenta "${merged.nombreCuenta}" sin subrubro asignado.`);
  }

  await MovementModel.updateOne(
    { _id: id },
    {
      $set: {
        empresa: merged.empresa,
        periodo: merged.periodo,
        fechaISO: fecha,
        numeroCuenta: merged.numeroCuenta.trim(),
        nombreCuenta: merged.nombreCuenta.trim(),
        numeroSubcuenta: merged.numeroSubcuenta?.trim() || null,
        nombreSubcuenta: merged.nombreSubcuenta?.trim() || null,
        detalle: merged.detalle?.trim() ?? '',
        debe: merged.debe ?? 0,
        haber: merged.haber ?? 0,
        rubro,
        numeroCuentaReimputada: merged.numeroCuenta.trim(),
        nombreCuentaReimputada: merged.nombreCuenta.trim(),
        rubroReimputada: rubro,
        subrubro,
      },
    },
  );

  const updated = await MovementModel.findById(id).lean<Movement>();
  return { movement: updated as Movement, warnings };
};

/** Delete a manual movement. Refuses to touch ledger/cmv-calc entries. */
export const deleteManualMovement = async (id: string): Promise<void> => {
  const existing = await MovementModel.findById(id).lean<Movement | null>();
  if (!existing) throw httpError(404, 'Movimiento no encontrado');
  if (existing.sourceType !== 'manual') {
    throw httpError(400, 'Solo se pueden borrar movimientos manuales');
  }
  await MovementModel.deleteOne({ _id: id });
};

/**
 * Catalog of (numeroCuenta, nombreCuenta) pairs ever seen in the DB.
 * Used by the autocomplete in the manual-entry form. Excludes the puente
 * (rubro = "Cuentas puentes") rows because the user shouldn't pick those.
 */
export type CuentaCatalogItem = {
  numeroCuenta: string;
  nombreCuenta: string;
  rubro: Rubro;
  /** how many movements have been seen with this exact pair */
  count: number;
};

export const getCuentasCatalog = async (): Promise<CuentaCatalogItem[]> => {
  const rows = await MovementModel.aggregate<{
    _id: { numeroCuenta: string; nombreCuenta: string; rubro: Rubro };
    count: number;
  }>([
    {
      $match: {
        rubroReimputada: { $in: VALID_PNL_BAL_RUBROS },
      },
    },
    {
      $group: {
        _id: {
          numeroCuenta: '$numeroCuentaReimputada',
          nombreCuenta: '$nombreCuentaReimputada',
          rubro: '$rubroReimputada',
        },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  return rows.map((r) => ({
    numeroCuenta: r._id.numeroCuenta,
    nombreCuenta: r._id.nombreCuenta,
    rubro: r._id.rubro,
    count: r.count,
  }));
};
