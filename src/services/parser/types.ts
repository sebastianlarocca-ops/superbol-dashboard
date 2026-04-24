import { Empresa } from '../../types/empresa';

/**
 * Shape of a single movement as extracted from a raw ledger file,
 * before any enrichment (reimputation / anulacion / subrubro).
 *
 * Numbers are strings because plans use alphanumeric codes ("z001", "f001"),
 * subaccount ids can be 17-digit CUIT-like values, and leading zeros ("0001")
 * are meaningful. See models/Movement.ts for the storage schema.
 */
export type ParsedMovement = {
  empresa: Empresa;
  periodo: string; // "MM/YYYY"
  fechaISO: Date;
  archivo: string; // original filename, for audit

  asiento: number;
  numeroCuenta: string;
  nombreCuenta: string;
  numeroSubcuenta: string | null;
  nombreSubcuenta: string | null;

  detalle: string; // aka concepto
  debe: number;
  haber: number;
};

/**
 * Non-critical issue detected while parsing (e.g. malformed row we skipped).
 * Collected and surfaced in the ingesta report alongside errors.
 */
export type ParseWarning = {
  code:
    | 'UNPARSEABLE_ROW'
    | 'MISSING_METADATA'
    | 'ACCOUNT_NAME_MISMATCH'
    | 'UNEXPECTED_STATE';
  message: string;
  rowNumber?: number; // 1-based for user-friendly references
  context?: Record<string, unknown>;
};

/**
 * Full result of parsing one ledger file.
 */
export type ParseResult = {
  empresa: Empresa;
  periodo: string;
  archivo: string;
  movements: ParsedMovement[];
  warnings: ParseWarning[];
  stats: {
    totalRows: number;
    movementsParsed: number;
    accountsSeen: number;
    subaccountsSeen: number;
  };
};
