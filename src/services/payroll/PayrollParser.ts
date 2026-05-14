import * as XLSX from 'xlsx';

// Sheet names that contain employee cost data (excludes 'Antiguedad').
const SECTOR_SHEETS = new Set([
  'ADMINISTRACION',
  'ADM DE PRODUCCION',
  'COMERCIAL',
  'CONTROL DE GESTION',
  'LOGISTICA',
  'MAESTRANZA',
  'MANTENIMIENTO',
  'PRODUCCION',
  'RRHH',
  'SISTEMAS INFORMATICOS',
]);

type AntiguedadEntry = {
  fechaIngreso: Date | null;
  anosAntiguedad: number | null;
};

export type ParsedPayrollRecord = {
  nomina: string;
  empresa: string;
  categoriaRecibo: string | null;
  sector: string;
  subSector: string | null;
  ctaDos: number;
  sueldoSinAntig: number;
  antiguedad: number;
  cargasSociales: number;
  aportesPersonales: number;
  totalPorPosicion: number;
  totalSueldoMasCargas: number;
  anosAntiguedad: number | null;
  fechaIngreso: Date | null;
  esBaja: boolean;
};

export type PayrollParseResult = {
  records: ParsedPayrollRecord[];
  warnings: string[];
};

const toNum = (v: unknown): number => {
  if (typeof v === 'number' && !isNaN(v)) return v;
  return 0;
};

const toStr = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
};

const normalizeName = (name: string): string =>
  name.trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * Detects the periodo from the filename pattern: e.g. "COSTO NOMINA POR SECTOR 02-2026.xlsx"
 * Accepts both "MM-YYYY" and "MM_YYYY" separators. Returns "MM/YYYY" or null if not found.
 */
export const detectPeriodoFromFilename = (filename: string): string | null => {
  const match = filename.match(/(\d{2})[-_](\d{4})/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
};

/**
 * Parses a payroll Excel file (multi-sheet format used by Superbol's HR team).
 *
 * Column layout differs between most sheets (standard) and MANTENIMIENTO:
 *   Standard:      col0=Nomina, col1=Empresa,          col2=CategoriaRecibo, col3=Sector, col4-10=costs, col12=años
 *   MANTENIMIENTO: col0=Nomina, col1=CategoriaRecibo,  col2=blank,           col3=Sector, col4-10=costs, col12=años
 *
 * Detection: if header[1] contains "empresa" → standard; otherwise → MANTENIMIENTO layout.
 * Rows where col0 is not a non-empty string are total/summary rows and are skipped.
 * Employees with subSector="BAJA" are kept but flagged with esBaja=true.
 */
export const parsePayroll = (buffer: Buffer): PayrollParseResult => {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const warnings: string[] = [];

  // Build Antiguedad lookup: normalizedName → { fechaIngreso, anosAntiguedad }
  const antiguedadMap = new Map<string, AntiguedadEntry>();
  const antiguedadSheet = wb.Sheets['Antiguedad'];
  if (antiguedadSheet) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(antiguedadSheet, {
      header: 1,
      raw: true,
      defval: null,
    });
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];
      const name = toStr(row[1]);
      if (!name) continue;
      const key = normalizeName(name);
      const fechaRaw = row[2];
      const fechaIngreso =
        fechaRaw instanceof Date && !isNaN(fechaRaw.getTime()) ? fechaRaw : null;
      const anosAntiguedad = typeof row[3] === 'number' ? row[3] : null;
      antiguedadMap.set(key, { fechaIngreso, anosAntiguedad });
    }
  } else {
    warnings.push('Hoja "Antiguedad" no encontrada — sin datos de fecha de ingreso');
  }

  const records: ParsedPayrollRecord[] = [];

  for (const sheetName of wb.SheetNames) {
    if (!SECTOR_SHEETS.has(sheetName)) continue;

    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });

    if (rows.length < 2) continue;

    // Detect schema variant by checking if col1 header contains "empresa"
    const headers = rows[0] as unknown[];
    const hasEmpresaCol =
      typeof headers[1] === 'string' && headers[1].toLowerCase().includes('empresa');

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as unknown[];

      // Skip total/summary rows — valid employee rows always have a string in col0
      const nominaRaw = row[0];
      if (typeof nominaRaw !== 'string' || !nominaRaw.trim()) continue;
      const nomina = nominaRaw.trim();

      let empresa: string;
      let categoriaRecibo: string | null;

      if (hasEmpresaCol) {
        empresa = toStr(row[1]) ?? 'SUPERBOL';
        categoriaRecibo = toStr(row[2]);
      } else {
        // MANTENIMIENTO layout: no Empresa column
        empresa = 'SUPERBOL';
        categoriaRecibo = toStr(row[1]);
      }

      const subSector = toStr(row[3]);
      const esBaja = subSector?.toUpperCase() === 'BAJA';

      // Enrich from Antiguedad sheet; fall back to the años column in the row
      const key = normalizeName(nomina);
      const antig = antiguedadMap.get(key);
      const anosAntiguedad =
        antig?.anosAntiguedad ?? (typeof row[12] === 'number' ? row[12] : null);

      records.push({
        nomina,
        empresa,
        categoriaRecibo,
        sector: sheetName,
        subSector,
        ctaDos: toNum(row[4]),
        sueldoSinAntig: toNum(row[5]),
        antiguedad: toNum(row[6]),
        cargasSociales: toNum(row[7]),
        aportesPersonales: toNum(row[8]),
        totalPorPosicion: toNum(row[9]),
        totalSueldoMasCargas: toNum(row[10]),
        anosAntiguedad,
        fechaIngreso: antig?.fechaIngreso ?? null,
        esBaja,
      });
    }
  }

  return { records, warnings };
};
