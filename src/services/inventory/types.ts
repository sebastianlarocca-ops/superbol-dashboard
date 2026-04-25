/**
 * Shape of a single parsed row from the INFORME sheet (valorized inventory
 * by category). One row per product category (e.g. "MP", "PROD_TERM",
 * "STOCK_DE_BOBINAS_BICAPA"). Both raw inputs (units × price per month) and
 * derived valorizaciones are kept; the CMVCalculator is responsible for
 * adding the `costoFinanciero` + `casoCalculado` fields downstream.
 */
export type InventoryParsedRow = {
  categoria: string;

  // SI (Stock Inicial = mes anterior; en el archivo de julio → columnas J, L)
  unidMesAnterior: number;
  precioMesAnterior: number;
  valorMesAnterior: number; // = unidMesAnterior × precioMesAnterior

  // SF (Stock Final = mes en curso; en el archivo de julio → columnas M, N)
  unidMesEnCurso: number;
  precioMesEnCurso: number;
  valorMesEnCurso: number; // = unidMesEnCurso × precioMesEnCurso

  // Audit-only: Excel's "Merma mensual %" column. Not used in CMV formula.
  mermaPct: number | null;
};

/**
 * Codes for parsing warnings surfaced to the caller (e.g. the UI or ingesta
 * endpoint). Non-fatal — parser keeps going and lets the caller decide.
 */
export type InventoryParseWarningCode =
  | 'UNPARSEABLE_ROW' // row couldn't be turned into a category line
  | 'SHEET_NOT_FOUND' // INFORME sheet missing
  | 'HEADER_NOT_FOUND' // couldn't locate the "Suma de INVENTARIO JUNIO" header row
  | 'TOTAL_MISMATCH'; // sum of items ≠ "Total general" row

export type InventoryParseWarning = {
  code: InventoryParseWarningCode;
  rowNumber?: number;
  message: string;
};

export type InventoryParseResult = {
  rows: InventoryParsedRow[];
  warnings: InventoryParseWarning[];
  stats: {
    totalRows: number;
    itemsParsed: number;
    totalValorMesAnterior: number;
    totalValorMesEnCurso: number;
  };
};
