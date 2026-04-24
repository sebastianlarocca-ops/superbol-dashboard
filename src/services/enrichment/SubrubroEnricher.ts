import { SubrubroMap } from '../../models';

/**
 * Resolves a reimputed account name to its subrubro.
 *
 * Decision from Fase 1 rules review:
 *   - Match is case-INSENSITIVE (only one canonical entry per account name;
 *     the lookup normalizes both sides to lowercase).
 *   - No match → returns null → movement.subrubro = null → rolls up as
 *     "(sin subrubro)" in reports + warning surfaced to the user.
 */
export class SubrubroEnricher {
  private index: Map<string, string> = new Map();

  constructor(maps: SubrubroMap[]) {
    for (const m of maps) {
      const key = m.nombreCuentaReimputada.trim().toLowerCase();
      if (this.index.has(key)) {
        console.warn(
          `[SubrubroEnricher] Duplicate entry for "${m.nombreCuentaReimputada}" (case-insensitive) — keeping first`,
        );
        continue;
      }
      this.index.set(key, m.nombreSubrubro);
    }
  }

  findSubrubro(nombreCuentaReimputada: string): string | null {
    const key = nombreCuentaReimputada.trim().toLowerCase();
    return this.index.get(key) ?? null;
  }
}
