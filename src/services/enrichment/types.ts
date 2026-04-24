import { Empresa, Rubro } from '../../types/empresa';
import { ParsedMovement } from '../parser/types';

/**
 * A ParsedMovement after running through the full enrichment pipeline:
 * reimputation (+ derived rubro) → anulación tag → subrubro lookup.
 *
 * The shape mirrors models/Movement.ts exactly — this is what the ingestion
 * endpoint will persist.
 */
export type EnrichedMovement = ParsedMovement & {
  empresa: Empresa;
  rubro: Rubro; // derived from numeroCuenta (original)
  numeroCuentaReimputada: string;
  nombreCuentaReimputada: string;
  rubroReimputada: Rubro; // derived from numeroCuentaReimputada
  subrubro: string | null;
  anulacion: boolean;
  sourceType: 'ledger';
};

export type EnrichmentWarning = {
  code:
    | 'SUBRUBRO_NOT_FOUND'
    // Fired when a movement's cuenta/subcuenta combination hasn't been
    // classified (neither a reimputation rule matches nor a subrubro).
    // Helps the user spot new accounts they haven't mapped yet.
    | 'UNCLASSIFIED_REIMPUTACION';
  message: string;
  // Unique natural key so the UI can group/count distinct cases:
  key: string;
  // How many movements of this period hit this warning.
  occurrences: number;
};

export type EnrichmentResult = {
  movements: EnrichedMovement[];
  warnings: EnrichmentWarning[];
  stats: {
    input: number;
    reimputed: number; // how many had a matching reimputation rule
    anulados: number;
    subrubrosMapped: number;
    unmappedSubrubros: number;
    unclassifiedReimputacion: number;
  };
};
