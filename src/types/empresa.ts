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
 * Classifies a rubro based on numeroCuenta ranges.
 * Mirrors the logic from the n8n workflow.
 * - 1000-2999 → Activo
 * - 3000-3999 → Pasivo
 * - 6000-6999 → Resultado negativo
 * - 7000-7999 → Resultado positivo
 * - everything else (including NaN / non-numeric like "f001") → Cuentas puentes
 */
export const classifyRubro = (numeroCuenta: number | string): Rubro => {
  const n = typeof numeroCuenta === 'number' ? numeroCuenta : parseInt(String(numeroCuenta), 10);
  if (Number.isNaN(n)) return 'Cuentas puentes';
  if (n >= 1000 && n <= 2999) return 'Activo';
  if (n >= 3000 && n <= 3999) return 'Pasivo';
  if (n >= 6000 && n <= 6999) return 'Resultado negativo';
  if (n >= 7000 && n <= 7999) return 'Resultado positivo';
  return 'Cuentas puentes';
};
