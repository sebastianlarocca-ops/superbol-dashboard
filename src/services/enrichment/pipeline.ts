import {
  AnulacionRule,
  ReimputationRule,
  SubrubroMap,
  AnulacionRuleModel,
  ReimputationRuleModel,
  SubrubroMapModel,
} from '../../models';
import { classifyRubro } from '../../types/empresa';
import { ParsedMovement } from '../parser/types';
import { AnulacionTagger } from './AnulacionTagger';
import { Reimputator } from './Reimputator';
import { SubrubroEnricher } from './SubrubroEnricher';
import { EnrichedMovement, EnrichmentResult, EnrichmentWarning } from './types';

/**
 * Runs the 3-step enrichment pipeline in order:
 *   1. Reimputator       → numeroCuentaReimputada, nombreCuentaReimputada, rubroReimputada
 *   2. AnulacionTagger   → anulacion (boolean)
 *   3. SubrubroEnricher  → subrubro (nullable)
 *
 * Order matters: subrubro lookup uses `nombreCuentaReimputada` (the reimputed
 * name), so it MUST run after the Reimputator.
 *
 * Anulación order is independent; we put it in the middle for readability —
 * it operates on the original cuenta/subcuenta names (not the reimputed ones).
 *
 * Rubro (original) is computed from numeroCuenta; rubroReimputada from
 * numeroCuentaReimputada. Both are always present.
 */
export const enrichMovements = (
  movements: ParsedMovement[],
  deps: {
    reimputator: Reimputator;
    anulacionTagger: AnulacionTagger;
    subrubroEnricher: SubrubroEnricher;
  },
): EnrichmentResult => {
  const { reimputator, anulacionTagger, subrubroEnricher } = deps;

  const enriched: EnrichedMovement[] = [];
  let reimputed = 0;
  let anulados = 0;
  let subrubrosMapped = 0;

  // Count distinct warning cases so we don't emit one warning per movement
  // (29,000 rows × 1 unmapped account would flood the UI).
  const unmappedSubrubroCases = new Map<string, number>();
  const unclassifiedReimputacionCases = new Map<string, number>();

  for (const m of movements) {
    // 1. Reimputation
    const rule = reimputator.findRule(m);
    let numeroCuentaReimputada: string;
    let nombreCuentaReimputada: string;
    if (rule) {
      numeroCuentaReimputada = rule.hacia.numeroCuenta;
      nombreCuentaReimputada = rule.hacia.nombreCuenta;
      reimputed++;
    } else {
      numeroCuentaReimputada = m.numeroCuenta;
      nombreCuentaReimputada = m.nombreCuenta;
    }

    const rubro = classifyRubro(m.numeroCuenta);
    const rubroReimputada = classifyRubro(numeroCuentaReimputada);

    // 2. Anulación
    const anulacion = anulacionTagger.isAnulado(m);
    if (anulacion) anulados++;

    // 3. Subrubro
    const subrubro = subrubroEnricher.findSubrubro(nombreCuentaReimputada);
    if (subrubro) {
      subrubrosMapped++;
    } else if (rubroReimputada === 'Resultado negativo' || rubroReimputada === 'Resultado positivo') {
      // Only warn for P&L accounts — patrimoniales (Activo/Pasivo) don't need a subrubro.
      const key = `${numeroCuentaReimputada}|${nombreCuentaReimputada}`;
      unmappedSubrubroCases.set(key, (unmappedSubrubroCases.get(key) ?? 0) + 1);
    }

    // Extra warning: cuenta puente that wasn't reclassified to a real rubro
    // (reimputation left it as "Cuentas puentes" — user should add a rule).
    if (rubroReimputada === 'Cuentas puentes') {
      const key = `${numeroCuentaReimputada}|${nombreCuentaReimputada}|${m.nombreSubcuenta ?? ''}`;
      unclassifiedReimputacionCases.set(
        key,
        (unclassifiedReimputacionCases.get(key) ?? 0) + 1,
      );
    }

    enriched.push({
      ...m,
      rubro,
      numeroCuentaReimputada,
      nombreCuentaReimputada,
      rubroReimputada,
      anulacion,
      subrubro,
      sourceType: 'ledger',
    });
  }

  const warnings: EnrichmentWarning[] = [];
  for (const [key, occurrences] of unmappedSubrubroCases) {
    const [num, nombre] = key.split('|');
    warnings.push({
      code: 'SUBRUBRO_NOT_FOUND',
      message: `Cuenta "${num} ${nombre}" sin subrubro asignado`,
      key,
      occurrences,
    });
  }
  for (const [key, occurrences] of unclassifiedReimputacionCases) {
    const [num, nombre, sub] = key.split('|');
    warnings.push({
      code: 'UNCLASSIFIED_REIMPUTACION',
      message:
        `Cuenta "${num} ${nombre}"${sub ? ` (subcuenta "${sub}")` : ''} queda en Cuentas puentes — ` +
        `no hay regla de reimputación que la reclasifique`,
      key,
      occurrences,
    });
  }

  const unmappedSubrubros = [...unmappedSubrubroCases.values()].reduce((a, b) => a + b, 0);
  const unclassifiedReimputacion = [...unclassifiedReimputacionCases.values()].reduce(
    (a, b) => a + b,
    0,
  );

  return {
    movements: enriched,
    warnings,
    stats: {
      input: movements.length,
      reimputed,
      anulados,
      subrubrosMapped,
      unmappedSubrubros,
      unclassifiedReimputacion,
    },
  };
};

/**
 * Convenience: loads all rules from the DB and returns a fully-wired pipeline
 * function that takes movements and returns an EnrichmentResult.
 */
export const loadEnrichmentPipeline = async (): Promise<
  (movements: ParsedMovement[]) => EnrichmentResult
> => {
  const [reimputationRules, anulacionRules, subrubroMaps] = await Promise.all([
    ReimputationRuleModel.find().lean<ReimputationRule[]>(),
    AnulacionRuleModel.find().lean<AnulacionRule[]>(),
    SubrubroMapModel.find().lean<SubrubroMap[]>(),
  ]);

  const reimputator = new Reimputator(reimputationRules);
  const anulacionTagger = new AnulacionTagger(anulacionRules);
  const subrubroEnricher = new SubrubroEnricher(subrubroMaps);

  return (movements: ParsedMovement[]) =>
    enrichMovements(movements, { reimputator, anulacionTagger, subrubroEnricher });
};
