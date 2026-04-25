import { EnrichedMovement } from '../enrichment/types';
import { InventoryParsedRow } from '../inventory/types';

/**
 * An InventoryItem computed from a parsed row — extends the raw parsed row
 * with the costo-financiero math. This is what gets persisted to MongoDB.
 */
export type EnrichedInventoryItem = InventoryParsedRow & {
  deltaPrecio: number; // precioMesEnCurso − precioMesAnterior (signed)
  casoCalculado: 'A' | 'B'; // A: SI>SF (quedaron SF); B: SI<=SF (quedaron SI)
  unidadesAfectadas: number; // SF si caso A; SI si caso B
  costoFinanciero: number; // unidadesAfectadas × deltaPrecio (signed)
};

/**
 * Pseudo-movements synthesized by the CMV calculator that get persisted in
 * the `movements` collection alongside ledger-sourced movements. They carry
 * `sourceType: 'cmv-calc'` so we can filter or rebuild them from the inventory
 * data without touching real ledger entries.
 *
 * Four movements are generated (all imputed to SUPERBOL — consolidated):
 *   1. Stock Inicial          → cuenta "Materia Prima" (6200), debe = SI total
 *   2. Stock Final            → cuenta "Materia Prima" (6200), haber = SF total
 *   3. Ajuste CMV por tenencia → cuenta "Materia Prima" (6200), signo inverso al de (4)
 *   4. Resultado por tenencia → cuenta "Resultados financieros" (7900)
 *
 * (3) and (4) are mirror entries: their sum on the P&L is zero, but (3)
 * reduces CMV (or increases it if pérdida) and (4) surfaces the financial
 * result as its own line under "Resultados financieros".
 */
export type CMVPseudoMovement = {
  // Matches the shape the pipeline produces for ledger movements. We leave
  // `_id`, `periodo`, `empresa`, `archivo`, `ingestionBatchId` to be filled
  // in by the ingesta endpoint (the calculator itself is pure).
  fechaISO: Date;
  asiento: number;
  numeroCuenta: string;
  nombreCuenta: string;
  numeroSubcuenta: string | null;
  nombreSubcuenta: string | null;
  detalle: string;
  debe: number;
  haber: number;

  // Enrichment fields — we precompute these since the reimputation rules
  // shouldn't apply to synthetic CMV entries.
  numeroCuentaReimputada: string;
  nombreCuentaReimputada: string;
  subrubro: string | null;
  // `rubro` and `rubroReimputada` are derived from numeroCuenta by the caller
  // using classifyRubro() — same path as real movements — so we don't store
  // them here.
  anulacion: false;
};

export type CMVResult = {
  // Per-item enriched inventory (what gets written to inventory_items)
  items: EnrichedInventoryItem[];

  // Aggregated totals (what gets written to IngestionBatch.stats)
  totals: {
    stockInicial: number;
    compras: number;
    stockFinal: number;
    cmvBruto: number; // SI + Compras − SF
    costoFinanciero: number; // signed: + = ganancia, − = pérdida
    cmvAjustado: number; // cmvBruto − costoFinanciero
  };

  // Synthetic movements that need to be persisted in the movements collection
  pseudoMovements: CMVPseudoMovement[];

  warnings: CMVWarning[];
};

export type CMVWarningCode =
  | 'NO_INVENTORY_ITEMS' // inventory parsed empty
  | 'NO_PURCHASES' // Compras = 0 (suspicious — usually there's always some MP purchase)
  | 'NEGATIVE_CMV'; // cmvBruto < 0 (SF > SI + Compras — accounting anomaly)

export type CMVWarning = {
  code: CMVWarningCode;
  message: string;
};

export type CMVCalcInput = {
  periodo: string; // "MM/YYYY"
  inventoryItems: InventoryParsedRow[];
  // All enriched movements for the period, across the 4 empresas. The calc
  // derives Compras by filtering numeroCuenta ∈ {1600, 1620, 6200} pre-
  // reimputación (the original numeroCuenta, not numeroCuentaReimputada).
  movements: EnrichedMovement[];
};
