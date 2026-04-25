import { PipelineStage } from 'mongoose';
import { MovementModel } from '../../models';
import { Rubro } from '../../types/empresa';
import {
  BalanceBucket,
  BalanceCuenta,
  BalanceQuery,
  BalanceResponse,
  PnLBucket,
  PnLCuenta,
  PnLQuery,
  PnLResponse,
  PnLSubrubro,
} from './types';

/** Result row from the grouped aggregation. */
type GroupedRow = {
  _id: {
    rubro: Rubro;
    subrubro: string | null;
    numeroCuenta: string;
    nombreCuenta: string;
  };
  debe: number;
  haber: number;
  movimientos: number;
};

/**
 * Build the $match stage common to all P&L / Balance queries. Filters by
 * period (always) and empresa (optional). Anulación flag is handled by the
 * caller because Balance includes them by default while P&L excludes them.
 */
const buildBaseMatch = (
  periodo: string,
  empresa?: string,
  extra?: Record<string, unknown>,
): PipelineStage.Match => {
  const match: Record<string, unknown> = { periodo };
  if (empresa) match.empresa = empresa;
  Object.assign(match, extra ?? {});
  return { $match: match };
};

/**
 * Group movimientos by (rubro, subrubro, numeroCuentaReimputada).
 * Always uses the *Reimputada* fields — that's the whole point of
 * reimputación: the real classification.
 */
const buildGroupStage = (): PipelineStage.Group => ({
  $group: {
    _id: {
      rubro: '$rubroReimputada',
      subrubro: '$subrubro',
      numeroCuenta: '$numeroCuentaReimputada',
      nombreCuenta: '$nombreCuentaReimputada',
    },
    debe: { $sum: '$debe' },
    haber: { $sum: '$haber' },
    movimientos: { $sum: 1 },
  },
});

/**
 * Sort: rubro alpha, then subrubro alpha (nulls last), then nombreCuenta.
 * Stable display order across calls.
 */
const buildSortStage = (): PipelineStage.Sort => ({
  $sort: {
    '_id.rubro': 1,
    '_id.subrubro': 1,
    '_id.nombreCuenta': 1,
  },
});

/**
 * Run the grouped aggregation against MovementModel and return the raw rows.
 * Subsequent shaping into PnL/Balance trees is done in pure JS.
 */
const runGroupedAggregation = async (matchStage: PipelineStage.Match): Promise<GroupedRow[]> => {
  const pipeline: PipelineStage[] = [matchStage, buildGroupStage(), buildSortStage()];
  return MovementModel.aggregate<GroupedRow>(pipeline);
};

// ─── P&L ────────────────────────────────────────────────────────────────────

export const queryPnL = async (q: PnLQuery): Promise<PnLResponse> => {
  const includeAnulados = q.includeAnulados ?? false;
  const extra: Record<string, unknown> = {
    rubroReimputada: { $in: ['Resultado positivo', 'Resultado negativo'] satisfies Rubro[] },
  };
  if (!includeAnulados) extra.anulacion = { $ne: true };

  const matchStage = buildBaseMatch(q.periodo, q.empresa, extra);
  const rows = await runGroupedAggregation(matchStage);

  const ingresos = buildPnLBucket(rows.filter((r) => r._id.rubro === 'Resultado positivo'), 'Resultado positivo');
  const egresos = buildPnLBucket(rows.filter((r) => r._id.rubro === 'Resultado negativo'), 'Resultado negativo');

  return {
    periodo: q.periodo,
    empresa: q.empresa ?? null,
    ingresos,
    egresos,
    resultadoNeto: ingresos.total - egresos.total,
    filters: { includeAnulados },
    warnings: [],
  };
};

/**
 * Group P&L rows by subrubro. `(sin subrubro)` bucket exists only as a safety
 * net — by design, P&L cuentas should always have a subrubro (we explicitly
 * warn during enrichment when they don't).
 */
const buildPnLBucket = (rows: GroupedRow[], rubro: Rubro): PnLBucket => {
  const subBySubrubro = new Map<string, GroupedRow[]>();
  for (const r of rows) {
    const key = r._id.subrubro ?? '(sin subrubro)';
    const arr = subBySubrubro.get(key) ?? [];
    arr.push(r);
    subBySubrubro.set(key, arr);
  }

  const subrubros: PnLSubrubro[] = [];
  let bucketTotal = 0;
  // Stable sort: by subrubro alpha; "(sin subrubro)" last.
  const keys = [...subBySubrubro.keys()].sort((a, b) => {
    if (a === '(sin subrubro)') return 1;
    if (b === '(sin subrubro)') return -1;
    return a.localeCompare(b);
  });

  for (const key of keys) {
    const subRows = subBySubrubro.get(key)!;
    const cuentas: PnLCuenta[] = subRows.map((r) => {
      const saldo = signedSaldo(rubro, r.debe, r.haber);
      return {
        numeroCuenta: r._id.numeroCuenta,
        nombreCuenta: r._id.nombreCuenta,
        saldo,
        debe: r.debe,
        haber: r.haber,
        movimientos: r.movimientos,
      };
    });
    cuentas.sort((a, b) => b.saldo - a.saldo); // largest first inside subrubro
    const total = cuentas.reduce((s, c) => s + c.saldo, 0);
    bucketTotal += total;
    subrubros.push({ subrubro: key, total, cuentas });
  }

  // Sort subrubros by total descending (biggest impact first), but keep
  // "(sin subrubro)" last regardless.
  subrubros.sort((a, b) => {
    if (a.subrubro === '(sin subrubro)') return 1;
    if (b.subrubro === '(sin subrubro)') return -1;
    return b.total - a.total;
  });

  return { total: bucketTotal, subrubros };
};

/**
 * Sign the saldo for display:
 *   - Resultado positivo (ingreso): haber − debe (saldo acreedor positivo)
 *   - Resultado negativo (gasto):   debe  − haber (saldo deudor positivo)
 *   - Activo:                        debe  − haber (saldo deudor positivo)
 *   - Pasivo:                        haber − debe (saldo acreedor positivo)
 */
const signedSaldo = (rubro: Rubro, debe: number, haber: number): number => {
  switch (rubro) {
    case 'Resultado positivo':
    case 'Pasivo':
      return haber - debe;
    case 'Resultado negativo':
    case 'Activo':
      return debe - haber;
    default:
      return debe - haber; // Cuentas puentes — shouldn't reach here
  }
};

// ─── Balance ────────────────────────────────────────────────────────────────

export const queryBalance = async (q: BalanceQuery): Promise<BalanceResponse> => {
  const matchStage = buildBaseMatch(q.periodo, q.empresa, {
    rubroReimputada: { $in: ['Activo', 'Pasivo'] satisfies Rubro[] },
  });
  const rows = await runGroupedAggregation(matchStage);

  const activo = buildBalanceBucket(rows.filter((r) => r._id.rubro === 'Activo'), 'Activo');
  const pasivo = buildBalanceBucket(rows.filter((r) => r._id.rubro === 'Pasivo'), 'Pasivo');

  return {
    periodo: q.periodo,
    empresa: q.empresa ?? null,
    activo,
    pasivo,
    patrimonioNeto: activo.total - pasivo.total,
  };
};

const buildBalanceBucket = (rows: GroupedRow[], rubro: Rubro): BalanceBucket => {
  const cuentas: BalanceCuenta[] = rows.map((r) => ({
    numeroCuenta: r._id.numeroCuenta,
    nombreCuenta: r._id.nombreCuenta,
    saldo: signedSaldo(rubro, r.debe, r.haber),
    debe: r.debe,
    haber: r.haber,
    movimientos: r.movimientos,
  }));
  cuentas.sort((a, b) => b.saldo - a.saldo);
  const total = cuentas.reduce((s, c) => s + c.saldo, 0);
  return { total, cuentas };
};
