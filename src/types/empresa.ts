export const EMPRESAS = ['SUPERBOL', 'PRUEBAS', 'SUSTEN', 'POINT'] as const;
export type Empresa = (typeof EMPRESAS)[number];

export const isEmpresa = (value: unknown): value is Empresa =>
  typeof value === 'string' && (EMPRESAS as readonly string[]).includes(value);

export const RUBROS = [
  'Activo',
  'Pasivo',
  'Resultado negativo',
  'Resultado positivo',
  'Cuentas puentes',
] as const;
export type Rubro = (typeof RUBROS)[number];

/**
 * Non-numeric reimputation target codes and the rubro they map to.
 * Comes from reimputaciones.xlsx — a handful of "hacia.numeroCuenta" values
 * are not real account numbers (e.g. "f001") and need explicit classification.
 *
 * Decision (rules review, Fase 1): keep these as hardcoded overrides until we
 * either (a) see them show up in actual ledgers, or (b) migrate to a proper
 * code-to-rubro lookup table.
 */
const NON_NUMERIC_RUBRO_OVERRIDES: Record<string, Rubro> = {
  f001: 'Resultado negativo', // intereses bancarios reimputados
};

/**
 * Classifies a rubro based on numeroCuenta ranges.
 * Mirrors the logic from the n8n workflow.
 * - 1000-2999 → Activo
 * - 3000-3999 → Pasivo
 * - 6000-6999 → Resultado negativo
 * - 7000-7999 → Resultado positivo
 * - non-numeric codes in NON_NUMERIC_RUBRO_OVERRIDES → explicit rubro
 * - everything else → Cuentas puentes
 */
export const classifyRubro = (numeroCuenta: number | string): Rubro => {
  if (typeof numeroCuenta === 'string') {
    const key = numeroCuenta.trim().toLowerCase();
    if (NON_NUMERIC_RUBRO_OVERRIDES[key]) return NON_NUMERIC_RUBRO_OVERRIDES[key];
  }
  const n = typeof numeroCuenta === 'number' ? numeroCuenta : parseInt(String(numeroCuenta), 10);
  if (Number.isNaN(n)) return 'Cuentas puentes';
  if (n >= 1000 && n <= 2999) return 'Activo';
  if (n >= 3000 && n <= 3999) return 'Pasivo';
  if (n >= 6000 && n <= 6999) return 'Resultado negativo';
  if (n >= 7000 && n <= 7999) return 'Resultado positivo';
  return 'Cuentas puentes';
};
