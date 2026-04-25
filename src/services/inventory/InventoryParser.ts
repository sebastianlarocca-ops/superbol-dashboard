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
 *   B: Suma de INVENTARIO JUNIO (unid raw) — IGNORED (we use J)
 *   C: Suma de COSTO INVENTARIO JUNIO ($)  — IGNORED (we use J × L)
 *   D: Suma de CONTEO 1 / E: MERMA 1
 *   F: Suma de conteo 2 / G: MERMA 2
 *   H: Suma de VALOR FINAL ($)             — IGNORED (we use M × N)
 *   I: Merma mensual %                     — kept for audit
 *   J: UNIDADES (junio)  ← SI units
 *   L: precio (junio)    ← SI price
 *   M: unid (julio)      ← SF units
 *   N: precio (julio)    ← SF price
 *
 * Decision to use J×L / M×N (not C / H) validated with Sebastián: Excel's
 * pre-computed C and H columns come from DATOS/FORMS roll-ups that don't
 * always match the quantities in J/M (rounding, merma exclusions). For CMV
 * we want the user-visible unit × price, which is what they type into the
 * report.
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

  // Find header row — it's the one that contains "Suma de INVENTARIO JUNIO"
  // in column B. Usually row 16, but we don't hard-code.
  let headerRow = -1;
  for (let i = 0; i < rawRows.length && i < 40; i++) {
    const r = rawRows[i];
    if (typeof r[1] === 'string' && r[1].toLowerCase().includes('inventario junio')) {
      headerRow = i;
      break;
    }
  }
  if (headerRow === -1) {
    warnings.push({
      code: 'HEADER_NOT_FOUND',
      message: 'No se encontró la fila header ("Suma de INVENTARIO JUNIO")',
    });
    return emptyResult(warnings);
  }

  const rows: InventoryParsedRow[] = [];
  let totalGeneralValorJunio: number | null = null;
  let totalGeneralValorJulio: number | null = null;

  for (let i = headerRow + 1; i < rawRows.length; i++) {
    const r = rawRows[i];

    const catRaw = r[0]; // col A
    if (typeof catRaw !== 'string') continue;
    const categoria = catRaw.trim();
    if (!categoria) continue;

    // "Total general" row — capture and stop (everything after is observations)
    if (/^total\s+general/i.test(categoria)) {
      const b = toNum(r[1]);
      const c = toNum(r[2]);
      // Totals in B/C are from Excel's pivot; we use them only for sanity check.
      if (c !== null) totalGeneralValorJunio = c;
      // Total general de valor julio sale del H (col 7) del total
      const h = toNum(r[7]);
      if (h !== null) totalGeneralValorJulio = h;
      void b;
      break;
    }

    // Core numeric fields. If J/L/M/N are all zero/null we skip (empty category).
    const unidMesAnterior = toNum(r[9]) ?? 0; // J
    const precioMesAnterior = toNum(r[11]) ?? 0; // L
    const unidMesEnCurso = toNum(r[12]) ?? 0; // M
    const precioMesEnCurso = toNum(r[13]) ?? 0; // N
    const mermaPct = toNum(r[8]); // I

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

  // Sanity check against Excel's "Total general" — useful to flag divergences
  // between J×L and C (pre-computed). Tolerance: 0.5% (prices are stored with
  // many decimals in Excel; reconstructed totals drift slightly).
  if (totalGeneralValorJulio !== null) {
    const drift = Math.abs(totalValorMesEnCurso - totalGeneralValorJulio);
    const rel = totalGeneralValorJulio === 0 ? 0 : drift / totalGeneralValorJulio;
    if (rel > 0.005) {
      warnings.push({
        code: 'TOTAL_MISMATCH',
        message:
          `Σ(M×N) = ${totalValorMesEnCurso.toFixed(2)} difiere de "Total general" H = ` +
          `${totalGeneralValorJulio.toFixed(2)} (drift ${(rel * 100).toFixed(2)}%)`,
      });
    }
  }
  // Junio too, but we warn only once to avoid noise.
  if (totalGeneralValorJunio !== null) {
    const drift = Math.abs(totalValorMesAnterior - totalGeneralValorJunio);
    const rel = totalGeneralValorJunio === 0 ? 0 : drift / totalGeneralValorJunio;
    if (rel > 0.05) {
      // Wider tolerance for the junio col — C comes from a different pivot
      // that may include items absent from J (historic drift).
      warnings.push({
        code: 'TOTAL_MISMATCH',
        message:
          `Σ(J×L) = ${totalValorMesAnterior.toFixed(2)} difiere de "Total general" C = ` +
          `${totalGeneralValorJunio.toFixed(2)} (drift ${(rel * 100).toFixed(2)}%) — ` +
          `esperable si C usa pivot histórico distinto de J`,
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
