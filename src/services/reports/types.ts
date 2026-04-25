import { Empresa } from '../../types/empresa';

/**
 * Account-level row in the P&L tree. `saldo` is already signed for display:
 *   - Resultado positivo (ingresos): saldo = haber − debe  (positivo normal = ingreso)
 *   - Resultado negativo (gastos):    saldo = debe  − haber (positivo normal = gasto)
 * If a Resultado-positivo cuenta has saldo deudor (debe > haber), saldo
 * comes out negative (rare; the UI surfaces it as such).
 */
export type PnLCuenta = {
  numeroCuenta: string;
  nombreCuenta: string;
  saldo: number;
  debe: number;
  haber: number;
  movimientos: number;
};

export type PnLSubrubro = {
  subrubro: string;
  total: number;
  cuentas: PnLCuenta[];
};

export type PnLBucket = {
  total: number;
  subrubros: PnLSubrubro[];
};

export type PnLResponse = {
  periodo: string;
  empresa: Empresa | null;
  ingresos: PnLBucket;
  egresos: PnLBucket;
  resultadoNeto: number;
  filters: {
    includeAnulados: boolean;
  };
  warnings: string[];
};

export type PnLQuery = {
  periodo: string;
  empresa?: Empresa;
  includeAnulados?: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Balance (patrimoniales — Activo / Pasivo). No subrubro layer.

export type BalanceCuenta = {
  numeroCuenta: string;
  nombreCuenta: string;
  saldo: number; // Activo: debe-haber ; Pasivo: haber-debe
  debe: number;
  haber: number;
  movimientos: number;
};

export type BalanceBucket = {
  total: number;
  cuentas: BalanceCuenta[];
};

export type BalanceResponse = {
  periodo: string;
  empresa: Empresa | null;
  activo: BalanceBucket;
  pasivo: BalanceBucket;
  patrimonioNeto: number; // activo - pasivo
};

export type BalanceQuery = {
  periodo: string;
  empresa?: Empresa;
};
