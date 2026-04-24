import { ReimputationRule } from '../../models';
import { ParsedMovement } from '../parser/types';

/**
 * Applies the reimputation rules to a movement. Decision from the Fase 1
 * rules review:
 *   - More specific rule wins (one with a matching `desde.nombreSubcuenta`
 *     before one with `null` subcuenta).
 *   - Match is exact, case-sensitive, on `nombreCuenta` and `nombreSubcuenta`.
 *   - If no rule matches, pass-through: `numeroCuentaReimputada = numeroCuenta`,
 *     `nombreCuentaReimputada = nombreCuenta`.
 *
 * The constructor pre-indexes rules for O(1) lookup per movement.
 */
export class Reimputator {
  // Two buckets per nombreCuenta: specific-subaccount rules and fallback rule.
  private specific: Map<string, Map<string, ReimputationRule>> = new Map();
  private fallback: Map<string, ReimputationRule> = new Map();

  constructor(rules: ReimputationRule[]) {
    for (const rule of rules) {
      const nombreCuenta = rule.desde.nombreCuenta;
      const nombreSub = rule.desde.nombreSubcuenta;
      if (nombreSub === null || nombreSub === undefined || nombreSub === '') {
        // Fallback rule: applies when no specific-subaccount rule matches.
        if (this.fallback.has(nombreCuenta)) {
          console.warn(
            `[Reimputator] Duplicate fallback rule for cuenta "${nombreCuenta}" — keeping first`,
          );
          continue;
        }
        this.fallback.set(nombreCuenta, rule);
      } else {
        let bucket = this.specific.get(nombreCuenta);
        if (!bucket) {
          bucket = new Map();
          this.specific.set(nombreCuenta, bucket);
        }
        if (bucket.has(nombreSub)) {
          console.warn(
            `[Reimputator] Duplicate specific rule for "${nombreCuenta}" / "${nombreSub}" — keeping first`,
          );
          continue;
        }
        bucket.set(nombreSub, rule);
      }
    }
  }

  /**
   * Returns the rule that applies, or null if no rule matches (pass-through).
   */
  findRule(movement: ParsedMovement): ReimputationRule | null {
    const specificBucket = this.specific.get(movement.nombreCuenta);
    if (specificBucket && movement.nombreSubcuenta) {
      const hit = specificBucket.get(movement.nombreSubcuenta);
      if (hit) return hit;
    }
    return this.fallback.get(movement.nombreCuenta) ?? null;
  }
}
