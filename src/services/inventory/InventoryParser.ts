import * as XLSX from 'xlsx';
import {
  InventoryParseResult,
  InventoryParseWarning,
  InventoryParsedRow,
} from './types';

/**
 * Parser for the inventory workbook. Reads the `INFORME` tab — the only one
 * that matters for CMV — and produces one `InventoryParsedRow` per product
 * category. Rows that are all-zero/empty are discarded early (noise from the
 * spreadsheet template).
 *
 * Column layout of INFORME (after header row ~16):
 *   A: categoria (string)
 *   B: Suma de INVENTARIO <mes> (unid raw) — IGNORED (we use the dynamic cols)
 *   C: Suma de COSTO INVENTARIO <mes> ($)  — IGNORED
 *   D: Suma de CONTEO 1 / E: MERMA 1
 *   F: Suma de conteo 2 / G: MERMA 2
 *   H: Suma de VALOR FINAL ($)             — IGNORED
 *   I: Merma mensual %                     — kept for audit
 *   J+: um/unid (mes anterior) ← SI units  — column detected dynamically
 *       precio  (mes anterior) ← SI price  — column detected dynamically
 *       unid    (mes en curso) ← SF units  — column detected dynamically
 *       precio  (mes en curso) ← SF price  — column detected dynamically
 *
 * The exact column offsets vary between monthly templates (e.g. an extra
 * column was added between July and September). We detect them by scanning
 * the header row for the pattern: um/unid → precio → unid → precio starting
 * from column J (index 9).
 *
 * Decision to use unit×price (not C / H) validated with Sebastián: Excel's
 * pre-computed C and H columns come from DATOS/FORMS roll-ups that don't
 * always match the quantities in the user-visible columns (rounding, merma
 * exclusions).
 */
export const parseInventory = (buffer: Buffer): InventoryParseResult => {
  const warnings: InventoryParseWarning[] = [];
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });

  if (!wb.Sheets['INFORME']) {
    warnings.push({
      code: 'SHEET_NOT_FOUND',
      message: 'Pestaña "INFORME" no encontrada en el archivo de inventario',
    });
    return emptyResult(warnings);
  }

  const sheet = wb.Sheets['INFORME'];
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true,
  });

  // Find header row — column B contains "Suma de INVENTARIO <mes>" where
  // <mes> is the month BEFORE the report period (junio for el archivo de julio,
  // agosto para el archivo de septiembre, etc.). We match by the stable
  // prefix "inventario" rather than hard-coding the month name.
  let headerRow = -1;
  for (let i = 0; i < rawRows.length && i < 40; i++) {
    const r = rawRows[i];
    if (typeof r[1] === 'string' && r[1].toLowerCase().includes('inventario')) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    warnings.push({
      code: 'HEADER_NOT_FOUND',
      message:
        'No se encontró la fila header (esperaba columna B con texto que contenga "INVENTARIO")',
    });
    return emptyResult(warnings);
  }

  // Detect the four data column positions dynamically from the header row.
  // Pattern starting from col J (9): (um|unid) precio unid precio
  // This handles templates where an extra column exists between SI-units and
  // SI-price (e.g. the September 2025 file has SI-price at K instead of L).
  const colSI = detectInventoryCols(rawRows[headerRow] as unknown[], warnings);

  const rows: InventoryParsedRow[] = [];
  let totalGeneralValorAnterior: number | null = null;
  let totalGeneralValorEnCurso: number | null = null;

  for (let i = headerRow + 1; i < rawRows.length; i++) {
    const r = rawRows[i];

    const catRaw = r[0]; // col A
    if (typeof catRaw !== 'string') continue;
    const categoria = catRaw.trim();
    if (!categoria) continue;

    // "Total general" row — capture and stop (everything after is observations)
    if (/^total\s+general/i.test(categoria)) {
      const c = toNum(r[2]);
      if (c !== null) totalGeneralValorAnterior = c;
      const h = toNum(r[7]);
      if (h !== null) totalGeneralValorEnCurso = h;
      break;
    }

    // Core numeric fields — use dynamically detected column indices.
    const unidMesAnterior = toNum(r[colSI.unidAnterior]) ?? 0;
    const precioMesAnterior = toNum(r[colSI.precioAnterior]) ?? 0;
    const unidMesEnCurso = toNum(r[colSI.unidEnCurso]) ?? 0;
    const precioMesEnCurso = toNum(r[colSI.precioEnCurso]) ?? 0;
    const mermaPct = toNum(r[8]); // col I — stable across templates

    if (
      unidMesAnterior === 0 &&
      precioMesAnterior === 0 &&
      unidMesEnCurso === 0 &&
      precioMesEnCurso === 0
    ) {
      continue; // all-zero row, skip silently
    }

    const valorMesAnterior = unidMesAnterior * precioMesAnterior;
    const valorMesEnCurso = unidMesEnCurso * precioMesEnCurso;

    rows.push({
      categoria,
      unidMesAnterior,
      precioMesAnterior,
      valorMesAnterior,
      unidMesEnCurso,
      precioMesEnCurso,
      valorMesEnCurso,
      mermaPct,
    });
  }

  const totalValorMesAnterior = rows.reduce((s, r) => s + r.valorMesAnterior, 0);
  const totalValorMesEnCurso = rows.reduce((s, r) => s + r.valorMesEnCurso, 0);

  // Sanity check against Excel's pre-computed "Total general" row.
  // Tolerance: 0.5% for SF (H col), 5% for SI (C col — different pivot, more drift).
  if (totalGeneralValorEnCurso !== null) {
    const drift = Math.abs(totalValorMesEnCurso - totalGeneralValorEnCurso);
    const rel = totalGeneralValorEnCurso === 0 ? 0 : drift / totalGeneralValorEnCurso;
    if (rel > 0.005) {
      warnings.push({
        code: 'TOTAL_MISMATCH',
        message:
          `Σ(SF unid × precio) = ${totalValorMesEnCurso.toFixed(2)} difiere de "Total general" H = ` +
          `${totalGeneralValorEnCurso.toFixed(2)} (drift ${(rel * 100).toFixed(2)}%)`,
      });
    }
  }
  if (totalGeneralValorAnterior !== null) {
    const drift = Math.abs(totalValorMesAnterior - totalGeneralValorAnterior);
    const rel = totalGeneralValorAnterior === 0 ? 0 : drift / totalGeneralValorAnterior;
    if (rel > 0.05) {
      warnings.push({
        code: 'TOTAL_MISMATCH',
        message:
          `Σ(SI unid × precio) = ${totalValorMesAnterior.toFixed(2)} difiere de "Total general" C = ` +
          `${totalGeneralValorAnterior.toFixed(2)} (drift ${(rel * 100).toFixed(2)}%) — ` +
          `esperable si C usa pivot histórico distinto`,
      });
    }
  }

  return {
    rows,
    warnings,
    stats: {
      totalRows: rawRows.length,
      itemsParsed: rows.length,
      totalValorMesAnterior,
      totalValorMesEnCurso,
    },
  };
};

interface ColIndices {
  unidAnterior: number;
  precioAnterior: number;
  unidEnCurso: number;
  precioEnCurso: number;
}

/**
 * Scan the header row (starting at col J / index 9) for the four data columns
 * using the pattern: (um|unid) → precio → unid → precio.
 * Falls back to the original hardcoded indices if the pattern isn't found.
 */
const detectInventoryCols = (
  headerRow: unknown[],
  warnings: InventoryParseWarning[],
): ColIndices => {
  const fallback: ColIndices = { unidAnterior: 9, precioAnterior: 11, unidEnCurso: 12, precioEnCurso: 13 };

  const found: number[] = [];
  // State: 0=looking for SI-units, 1=looking for SI-price, 2=looking for SF-units, 3=looking for SF-price
  let state = 0;
  for (let c = 9; c < headerRow.length && found.length < 4; c++) {
    const raw = headerRow[c];
    if (typeof raw !== 'string') continue;
    const v = raw.toLowerCase().trim();
    if (state === 0 && (v === 'um' || v === 'unid' || v.startsWith('unid'))) {
      found.push(c); state = 1;
    } else if (state === 1 && v.includes('precio')) {
      found.push(c); state = 2;
    } else if (state === 2 && (v === 'unid' || v.startsWith('unid'))) {
      found.push(c); state = 3;
    } else if (state === 3 && v.includes('precio')) {
      found.push(c); state = 4;
    }
  }

  if (found.length < 4) {
    warnings.push({
      code: 'HEADER_NOT_FOUND',
      message:
        `No se detectaron las 4 columnas de inventario (um/unid + precio + unid + precio) ` +
        `en la fila header. Usando columnas por defecto (J, L, M, N). ` +
        `Columnas detectadas: ${found.length} en posiciones [${found.join(', ')}]`,
    });
    return fallback;
  }

  return {
    unidAnterior: found[0],
    precioAnterior: found[1],
    unidEnCurso: found[2],
    precioEnCurso: found[3],
  };
};

const toNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const emptyResult = (warnings: InventoryParseWarning[]): InventoryParseResult => ({
  rows: [],
  warnings,
  stats: {
    totalRows: 0,
    itemsParsed: 0,
    totalValorMesAnterior: 0,
    totalValorMesEnCurso: 0,
  },
});
