import { EnrichedMovement } from '../enrichment/types';
import { InventoryParsedRow } from '../inventory/types';
import {
  CMVCalcInput,
  CMVPseudoMovement,
  CMVResult,
  CMVWarning,
  EnrichedInventoryItem,
} from './types';

// Cuentas usadas para calcular "Compras" desde el mayor (pre-reimputación).
// Nota: pre-reimputación significa que matcheamos contra `numeroCuenta`
// (original) — NO contra `numeroCuentaReimputada`. Así la lógica es
// determinística y no depende del estado de las reglas.
const PURCHASE_ACCOUNTS = new Set(['1600', '1620', '6200']);

// Cuenta virtual que usamos para representar el ajuste al stock y el CMV.
const CUENTA_MATERIA_PRIMA = { numero: '6200', nombre: 'Materia Prima' };

// Cuentas virtuales para el resultado por tenencia de inventario.
// Ganancia → Resultado positivo; pérdida → Resultado negativo. La división
// en dos cuentas la pidió Sebastián implícitamente: "ganancia al RP, pérdida
// al RN" — así el reporte P&L puede sumar por rubro sin signos mezclados.
const CUENTA_RESULTADOS_FINANCIEROS_RP = {
  numero: '7900',
  nombre: 'Resultados financieros',
};
const CUENTA_RESULTADOS_FINANCIEROS_RN = {
  numero: '6900',
  nombre: 'Resultados financieros',
};
const SUBCUENTA_TENENCIA = 'Resultado por tenencia de inventario';

/**
 * Given an inventory row, compute the costo-financiero fields. Two scenarios:
 *
 *   A) SI > SF (stock shrunk): las SF unidades son las que quedaron del mes
 *      anterior → costo = SF × Δprecio.
 *
 *   B) SI ≤ SF (stock creció o se mantuvo): de las SF unidades, solo las SI
 *      son las "viejas"; las demás entraron a precio nuevo y no afectan →
 *      costo = SI × Δprecio.
 *
 * Signo: ganancia (+) si Δprecio > 0 (precio subió, stock se revalorizó);
 * pérdida (−) si bajó.
 */
export const enrichInventoryItem = (row: InventoryParsedRow): EnrichedInventoryItem => {
  const deltaPrecio = row.precioMesEnCurso - row.precioMesAnterior;
  const caso: 'A' | 'B' = row.unidMesAnterior > row.unidMesEnCurso ? 'A' : 'B';
  const unidadesAfectadas = caso === 'A' ? row.unidMesEnCurso : row.unidMesAnterior;
  const costoFinanciero = unidadesAfectadas * deltaPrecio;

  return {
    ...row,
    deltaPrecio,
    casoCalculado: caso,
    unidadesAfectadas,
    costoFinanciero,
  };
};

/**
 * Suma (debe − haber) de todos los movimientos cuya cuenta ORIGINAL (pre-
 * reimputación) es 1600, 1620 o 6200. Incluye todas las empresas — el CMV es
 * consolidado y se imputa a SUPERBOL.
 */
const sumPurchases = (movements: EnrichedMovement[]): number => {
  let total = 0;
  for (const m of movements) {
    if (PURCHASE_ACCOUNTS.has(m.numeroCuenta)) {
      total += m.debe - m.haber;
    }
  }
  return total;
};

/**
 * Último día del mes del período "MM/YYYY" — lo usamos como fecha para los
 * pseudo-movements, así se ordenan al final del período en cualquier query
 * ordenada por fecha.
 */
const lastDayOfPeriodUTC = (periodo: string): Date => {
  const [mm, yyyy] = periodo.split('/').map((s) => parseInt(s, 10));
  // Day 0 of next month = last day of current month (in UTC).
  return new Date(Date.UTC(yyyy, mm, 0));
};

const makeMateriaPrimaPseudoMov = (
  fecha: Date,
  subcuenta: string,
  debe: number,
  haber: number,
  detalle: string,
): CMVPseudoMovement => ({
  fechaISO: fecha,
  asiento: 0,
  numeroCuenta: CUENTA_MATERIA_PRIMA.numero,
  nombreCuenta: CUENTA_MATERIA_PRIMA.nombre,
  numeroSubcuenta: null,
  nombreSubcuenta: subcuenta,
  detalle,
  debe,
  haber,
  numeroCuentaReimputada: CUENTA_MATERIA_PRIMA.numero,
  nombreCuentaReimputada: CUENTA_MATERIA_PRIMA.nombre,
  subrubro: 'Materia Prima',
  anulacion: false,
});

const makeResultadosFinancierosPseudoMov = (
  fecha: Date,
  signo: 'ganancia' | 'perdida',
  debe: number,
  haber: number,
  detalle: string,
): CMVPseudoMovement => {
  const cuenta =
    signo === 'ganancia'
      ? CUENTA_RESULTADOS_FINANCIEROS_RP
      : CUENTA_RESULTADOS_FINANCIEROS_RN;
  return {
    fechaISO: fecha,
    asiento: 0,
    numeroCuenta: cuenta.numero,
    nombreCuenta: cuenta.nombre,
    numeroSubcuenta: null,
    nombreSubcuenta: SUBCUENTA_TENENCIA,
    detalle,
    debe,
    haber,
    numeroCuentaReimputada: cuenta.numero,
    nombreCuentaReimputada: cuenta.nombre,
    subrubro: 'Resultados financieros',
    anulacion: false,
  };
};

/**
 * Pure CMV calculator. Takes parsed inventory + enriched movements and emits:
 *   - inventory items with costo-financiero per line (persisted to
 *     `inventory_items`);
 *   - aggregate totals (persisted to `ingestion_batches.stats`);
 *   - pseudo-movements (persisted to `movements` with sourceType='cmv-calc').
 *
 * No IO — the ingesta endpoint handles persistence.
 */
export const calculateCMV = (input: CMVCalcInput): CMVResult => {
  const warnings: CMVWarning[] = [];

  const items = input.inventoryItems.map(enrichInventoryItem);

  const stockInicial = items.reduce((s, it) => s + it.valorMesAnterior, 0);
  const stockFinal = items.reduce((s, it) => s + it.valorMesEnCurso, 0);
  const costoFinancieroTotal = items.reduce((s, it) => s + it.costoFinanciero, 0);
  const compras = sumPurchases(input.movements);

  const cmvBruto = stockInicial + compras - stockFinal;
  const cmvAjustado = cmvBruto - costoFinancieroTotal;

  if (items.length === 0) {
    warnings.push({
      code: 'NO_INVENTORY_ITEMS',
      message: 'El inventario no produjo ítems parseables',
    });
  }
  if (compras === 0 && items.length > 0) {
    warnings.push({
      code: 'NO_PURCHASES',
      message:
        'Compras = 0 — no hay movimientos en cuentas 1600/1620/6200 en el período. ' +
        'Verificar archivos de mayor.',
    });
  }
  if (cmvBruto < 0) {
    warnings.push({
      code: 'NEGATIVE_CMV',
      message:
        `CMV bruto negativo (${cmvBruto.toFixed(2)}): SF > SI + Compras. ` +
        `Revisar cierre de inventario y/o contabilización de compras.`,
    });
  }

  // Pseudo-movements: siempre 2 (SI y SF) + 2 más si cf ≠ 0 (ajuste CMV + RF)
  const fecha = lastDayOfPeriodUTC(input.periodo);
  const pseudoMovements: CMVPseudoMovement[] = [];

  // 1. Stock inicial → debe a Materia Prima (aumenta CMV por lo que había)
  if (stockInicial !== 0) {
    pseudoMovements.push(
      makeMateriaPrimaPseudoMov(
        fecha,
        'Stock inicial',
        stockInicial,
        0,
        `SI ${input.periodo} (consolidado inventario)`,
      ),
    );
  }

  // 2. Stock final → haber a Materia Prima (reduce CMV por lo que queda en stock)
  if (stockFinal !== 0) {
    pseudoMovements.push(
      makeMateriaPrimaPseudoMov(
        fecha,
        'Stock final',
        0,
        stockFinal,
        `SF ${input.periodo} (consolidado inventario)`,
      ),
    );
  }

  // 3 & 4: ajuste por tenencia. Espejo.
  //
  //   cf > 0 (ganancia):  Materia Prima ← haber cf  (reduce CMV)
  //                       Resultados financieros (RP) ← haber cf
  //   cf < 0 (pérdida):   Materia Prima ← debe |cf| (aumenta CMV)
  //                       Resultados financieros (RN) ← debe |cf|
  //
  // La suma sobre el P&L es cero (es una reclasificación pura), pero
  // discriminada en dos líneas distintas del reporte.
  if (costoFinancieroTotal !== 0) {
    const signo: 'ganancia' | 'perdida' = costoFinancieroTotal > 0 ? 'ganancia' : 'perdida';
    const abs = Math.abs(costoFinancieroTotal);
    const detalleMP =
      signo === 'ganancia'
        ? `Ajuste CMV por tenencia (ganancia) ${input.periodo}`
        : `Ajuste CMV por tenencia (pérdida) ${input.periodo}`;
    const detalleRF =
      signo === 'ganancia'
        ? `Resultado por tenencia de inventario (ganancia) ${input.periodo}`
        : `Resultado por tenencia de inventario (pérdida) ${input.periodo}`;

    pseudoMovements.push(
      makeMateriaPrimaPseudoMov(
        fecha,
        signo === 'ganancia' ? 'Ajuste tenencia (ganancia)' : 'Ajuste tenencia (pérdida)',
        signo === 'ganancia' ? 0 : abs,
        signo === 'ganancia' ? abs : 0,
        detalleMP,
      ),
    );
    pseudoMovements.push(
      makeResultadosFinancierosPseudoMov(
        fecha,
        signo,
        signo === 'ganancia' ? 0 : abs,
        signo === 'ganancia' ? abs : 0,
        detalleRF,
      ),
    );
  }

  return {
    items,
    totals: {
      stockInicial,
      compras,
      stockFinal,
      cmvBruto,
      costoFinanciero: costoFinancieroTotal,
      cmvAjustado,
    },
    pseudoMovements,
    warnings,
  };
};
