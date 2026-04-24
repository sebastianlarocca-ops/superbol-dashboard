import * as XLSX from 'xlsx';
import { Empresa } from '../../types/empresa';
import { ParsedMovement, ParseResult, ParseWarning } from './types';

/**
 * Stateful parser for libro mayor .xls/.xlsx files.
 *
 * Input format (from the Bejerman-style accounting export, as seen in the
 * sample file):
 *
 *   (header rows 1-15: metadata — empresa name, date range, column labels)
 *   "<numeroCuenta> <nombreCuenta>"                          ← account header
 *   "<numSub> <nomSub>" ... "Saldo Anterior" ... debe haber saldo
 *                                                            ← subaccount header
 *   [empty] [empty] <asiento> <fecha> <concepto> ... debe haber saldo
 *                                                            ← movement row
 *   ... more movements ...
 *   "Total Movimientos:" ...                                 ← end of subaccount
 *   [possibly more subaccounts of same account]
 *   "Totales de" "<numeroCuenta> <nombreCuenta>"             ← end of account
 *   ... more accounts ...
 *   "Totales del informe:" ...                               ← end of file
 *
 * Column indices (0-based, fixed in the report):
 *   0  → account/subaccount header strings, "Total Movimientos:", "Totales de"
 *   2  → asiento number (movement rows), "Totales del informe:"
 *   3  → fecha (movement rows)
 *   4  → concepto/detalle
 *   5  → "Saldo Anterior" literal (subaccount header row)
 *   7  → debe
 *   8  → haber
 *   9  → saldo
 *
 * The parser is a small state machine:
 *   IDLE → IN_ACCOUNT → IN_SUBACCOUNT → (back to IN_ACCOUNT on subacct total)
 *                                     → (back to IDLE on account total)
 *
 * We only produce ParsedMovements while in IN_SUBACCOUNT state, using the
 * remembered account + subaccount as context.
 */

type Row = unknown[];

type State =
  | { kind: 'IDLE' }
  | { kind: 'IN_ACCOUNT'; numeroCuenta: string; nombreCuenta: string }
  | {
      kind: 'IN_SUBACCOUNT';
      numeroCuenta: string;
      nombreCuenta: string;
      numeroSubcuenta: string;
      nombreSubcuenta: string;
    };

type RowType =
  | { type: 'EMPTY' }
  | { type: 'ACCOUNT_HEADER'; numero: string; nombre: string }
  | { type: 'SUBACCOUNT_HEADER'; numero: string; nombre: string }
  | {
      type: 'MOVEMENT';
      asiento: number;
      fecha: Date;
      concepto: string;
      debe: number;
      haber: number;
    }
  | { type: 'SUBACCOUNT_TOTAL' }
  | { type: 'ACCOUNT_TOTAL' }
  | { type: 'GRAND_TOTAL' }
  | { type: 'UNKNOWN' };

// ---------- helpers ----------

const isEmptyCell = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const isEmptyRow = (row: Row): boolean => row.every(isEmptyCell);

const toNumber = (v: unknown): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.replace(/\./g, '').replace(',', '.'));
    if (!Number.isNaN(n)) return n;
  }
  return 0;
};

const toTrimmedString = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : String(v ?? '').trim();

/**
 * Splits strings like "1000 Caja" or "96667112106551402 Yessica Erazo"
 * into [numero, nombre]. Split on first whitespace.
 */
const splitAccountLabel = (label: string): { numero: string; nombre: string } | null => {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\S+)\s+(.+)$/);
  if (!m) return { numero: trimmed, nombre: '' };
  return { numero: m[1], nombre: m[2].trim() };
};

/**
 * Attempts to classify a row. The caller is responsible for skipping empty
 * rows before invoking (this just returns EMPTY when appropriate).
 */
const classifyRow = (row: Row): RowType => {
  if (isEmptyRow(row)) return { type: 'EMPTY' };

  const c0 = row[0];
  const c2 = row[2];
  const c3 = row[3];
  const c4 = row[4];
  const c5 = row[5];
  const c7 = row[7];
  const c8 = row[8];

  // Grand total: col 2 = "Totales del informe:"
  if (typeof c2 === 'string' && c2.trim() === 'Totales del informe:') {
    return { type: 'GRAND_TOTAL' };
  }

  // Account total: col 0 = "Totales de"
  if (typeof c0 === 'string' && c0.trim() === 'Totales de') {
    return { type: 'ACCOUNT_TOTAL' };
  }

  // Subaccount total: col 0 = "Total Movimientos:"
  if (typeof c0 === 'string' && c0.trim() === 'Total Movimientos:') {
    return { type: 'SUBACCOUNT_TOTAL' };
  }

  // Subaccount header: col 0 is "<num> <name>" AND col 5 = "Saldo Anterior"
  if (typeof c0 === 'string' && c0.trim() !== '') {
    const saldoAnterior = typeof c5 === 'string' && c5.trim() === 'Saldo Anterior';
    if (saldoAnterior) {
      const parts = splitAccountLabel(c0);
      if (parts) return { type: 'SUBACCOUNT_HEADER', numero: parts.numero, nombre: parts.nombre };
    } else if (isEmptyCell(c5) && isEmptyCell(c7) && isEmptyCell(c2)) {
      // Account header: col 0 has label, cols 2/5/7 all empty
      const parts = splitAccountLabel(c0);
      if (parts) return { type: 'ACCOUNT_HEADER', numero: parts.numero, nombre: parts.nombre };
    }
  }

  // Movement: col 0 empty AND col 2 numeric (asiento) AND col 3 is Date
  if (isEmptyCell(c0) && typeof c2 === 'number' && c3 instanceof Date) {
    return {
      type: 'MOVEMENT',
      asiento: c2,
      fecha: c3,
      concepto: toTrimmedString(c4),
      debe: toNumber(c7),
      haber: toNumber(c8),
    };
  }

  return { type: 'UNKNOWN' };
};

/**
 * Derives periodo "MM/YYYY" from a Date (UTC-safe — Excel serial dates land
 * at UTC midnight; using local getters would misclassify in non-UTC zones).
 */
const periodoFromDate = (d: Date): string => {
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${mm}/${yyyy}`;
};

// ---------- parser ----------

export type ParseOptions = {
  empresa: Empresa;
  archivo: string;
  /** Optional: expected periodo ("MM/YYYY") for validation. */
  expectedPeriodo?: string;
};

export const parseLedger = (buffer: Buffer, opts: ParseOptions): ParseResult => {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('El archivo no tiene hojas');

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const warnings: ParseWarning[] = [];
  const movements: ParsedMovement[] = [];
  const accountsSeen = new Set<string>();
  const subaccountsSeen = new Set<string>();

  let state: State = { kind: 'IDLE' };
  let periodo: string | null = null;
  let finished = false;

  for (let i = 0; i < rows.length; i++) {
    if (finished) break;
    const row = rows[i];
    const rowNumber = i + 1;
    const kind = classifyRow(row);

    switch (kind.type) {
      case 'EMPTY':
        continue;

      case 'ACCOUNT_HEADER': {
        if (state.kind === 'IN_SUBACCOUNT') {
          warnings.push({
            code: 'UNEXPECTED_STATE',
            message: `Nuevo header de cuenta antes de cerrar subcuenta "${state.nombreSubcuenta}"`,
            rowNumber,
          });
        }
        state = {
          kind: 'IN_ACCOUNT',
          numeroCuenta: kind.numero,
          nombreCuenta: kind.nombre,
        };
        accountsSeen.add(kind.numero);
        break;
      }

      case 'SUBACCOUNT_HEADER': {
        if (state.kind === 'IDLE') {
          warnings.push({
            code: 'UNEXPECTED_STATE',
            message: `Header de subcuenta sin cuenta activa: "${kind.numero} ${kind.nombre}"`,
            rowNumber,
          });
          // Still record it with a placeholder; the data would be lost otherwise.
          state = {
            kind: 'IN_SUBACCOUNT',
            numeroCuenta: '(desconocida)',
            nombreCuenta: '(desconocida)',
            numeroSubcuenta: kind.numero,
            nombreSubcuenta: kind.nombre,
          };
        } else {
          state = {
            kind: 'IN_SUBACCOUNT',
            numeroCuenta: state.numeroCuenta,
            nombreCuenta: state.nombreCuenta,
            numeroSubcuenta: kind.numero,
            nombreSubcuenta: kind.nombre,
          };
        }
        subaccountsSeen.add(`${state.numeroCuenta}/${kind.numero}`);
        break;
      }

      case 'MOVEMENT': {
        if (state.kind !== 'IN_SUBACCOUNT') {
          warnings.push({
            code: 'UNEXPECTED_STATE',
            message: `Movimiento fuera de contexto de subcuenta (asiento ${kind.asiento})`,
            rowNumber,
            context: { asiento: kind.asiento },
          });
          continue;
        }

        if (!periodo) {
          periodo = periodoFromDate(kind.fecha);
        }

        movements.push({
          empresa: opts.empresa,
          periodo: periodo,
          fechaISO: kind.fecha,
          archivo: opts.archivo,

          asiento: kind.asiento,
          numeroCuenta: state.numeroCuenta,
          nombreCuenta: state.nombreCuenta,
          numeroSubcuenta: state.numeroSubcuenta,
          nombreSubcuenta: state.nombreSubcuenta,

          detalle: kind.concepto,
          debe: kind.debe,
          haber: kind.haber,
        });
        break;
      }

      case 'SUBACCOUNT_TOTAL': {
        if (state.kind === 'IN_SUBACCOUNT') {
          state = {
            kind: 'IN_ACCOUNT',
            numeroCuenta: state.numeroCuenta,
            nombreCuenta: state.nombreCuenta,
          };
        }
        // If not in subaccount, just ignore — these rows also appear after
        // subaccounts with zero movements.
        break;
      }

      case 'ACCOUNT_TOTAL': {
        state = { kind: 'IDLE' };
        break;
      }

      case 'GRAND_TOTAL': {
        finished = true;
        break;
      }

      case 'UNKNOWN': {
        // Silent-ignore known pre-body rows: any non-empty row before the
        // first ACCOUNT_HEADER is metadata/headers we don't care about.
        if (accountsSeen.size > 0) {
          warnings.push({
            code: 'UNPARSEABLE_ROW',
            message: 'Fila no reconocida en medio del libro mayor',
            rowNumber,
            context: { firstCells: row.slice(0, 6) },
          });
        }
        break;
      }
    }
  }

  if (!periodo) {
    warnings.push({
      code: 'MISSING_METADATA',
      message: 'No se pudo inferir el periodo (el archivo no tiene movimientos)',
    });
    periodo = '00/0000';
  }

  if (opts.expectedPeriodo && opts.expectedPeriodo !== periodo) {
    warnings.push({
      code: 'MISSING_METADATA',
      message: `Periodo inferido (${periodo}) no coincide con el esperado (${opts.expectedPeriodo})`,
    });
  }

  return {
    empresa: opts.empresa,
    periodo,
    archivo: opts.archivo,
    movements,
    warnings,
    stats: {
      totalRows: rows.length,
      movementsParsed: movements.length,
      accountsSeen: accountsSeen.size,
      subaccountsSeen: subaccountsSeen.size,
    },
  };
};
