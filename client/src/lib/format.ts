/** Formatting helpers shared across views. */

/** Argentine money — 2 decimals, dot thousands, comma decimal. */
export const fmtMoney = (n: number): string =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Same but signed with explicit "+" for positives — use in deltas. */
export const fmtMoneySigned = (n: number): string => (n > 0 ? `+${fmtMoney(n)}` : fmtMoney(n));

/** Compact number (1.2M, 850K) — for KPI tiles where space is tight. */
export const fmtMoneyCompact = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
};

/** "07/2025" → "Julio 2025". Defensive: returns input unchanged if not MM/YYYY. */
export const fmtPeriodo = (p: string): string => {
  const m = /^(\d{2})\/(\d{4})$/.exec(p);
  if (!m) return p;
  const [, mm, yyyy] = m;
  const meses = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  const idx = parseInt(mm, 10) - 1;
  if (idx < 0 || idx > 11) return p;
  return `${meses[idx]} ${yyyy}`;
};
