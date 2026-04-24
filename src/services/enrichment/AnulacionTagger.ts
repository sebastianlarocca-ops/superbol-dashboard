import { AnulacionRule } from '../../models';
import { ParsedMovement } from '../parser/types';

/**
 * Marks movements that match an anulación rule with `anulacion: true`.
 *
 * Decision from Fase 1 rules review:
 *   - Match is exact, case-sensitive, on BOTH `nombreCuenta` and
 *     `nombreSubcuenta` (subcuenta is required — anulación rules always have
 *     both coordinates).
 *   - The movement is preserved in the DB; the tag just flags it. Default
 *     reports exclude these from totals but they remain visible in a
 *     dedicated "Anulaciones" panel.
 */
export class AnulacionTagger {
  // Key = `${nombreCuenta}|${nombreSubcuenta}` → rule
  private index: Map<string, AnulacionRule> = new Map();

  constructor(rules: AnulacionRule[]) {
    for (const rule of rules) {
      const key = `${rule.cuenta.nombreCuenta}|${rule.subcuenta.nombreSubcuenta}`;
      if (this.index.has(key)) {
        console.warn(`[AnulacionTagger] Duplicate rule for "${key}" — keeping first`);
        continue;
      }
      this.index.set(key, rule);
    }
  }

  isAnulado(movement: ParsedMovement): boolean {
    if (!movement.nombreSubcuenta) return false;
    const key = `${movement.nombreCuenta}|${movement.nombreSubcuenta}`;
    return this.index.has(key);
  }
}
