import clsx from 'clsx';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { fmtPeriodo } from '../lib/format';
import { useCurrency } from '../context/CurrencyContext';

export type KPICardProps = {
  label: string;
  value: number;
  /** If provided, shows delta vs this value with arrow + % + absolute. */
  previousValue?: number | null;
  /** Optional context for the previous value (e.g. "vs Julio 2025"). */
  previousLabel?: string;
  /** Format value as percentage instead of money. */
  isPercentage?: boolean;
  /** When the metric is a "cost" we paint negative (= ahorro) green. */
  invertSemantics?: boolean;
  /** Used to highlight one or two flagship KPIs (extra-prominent). */
  highlight?: boolean;
  /** Period for currency conversion (MM/YYYY). Required for money values. */
  periodo?: string | null;
};

/**
 * Single KPI tile. Behaviour:
 *  - Shows the absolute value, formatted as money or %.
 *  - If previousValue is provided, computes Δ% and Δabs and shows them with
 *    an up/down/flat arrow. Color follows the natural "good = green" rule
 *    (positive Δ = green) unless invertSemantics is true (e.g. for CMV,
 *    where a *lower* cost is a positive signal).
 *  - If previousValue is null/undefined (first month), shows a soft hint
 *    instead of "Δ N/A" so the layout doesn't feel broken.
 */
export function KPICard({
  label,
  value,
  previousValue,
  previousLabel,
  isPercentage,
  invertSemantics,
  highlight,
  periodo,
}: KPICardProps) {
  const { fmt, currency } = useCurrency();
  const prefix = currency === 'USD' ? '' : '$ ';
  const formatted = isPercentage ? `${value.toFixed(1)}%` : `${prefix}${fmt(value, periodo)}`;

  const hasDelta = previousValue !== null && previousValue !== undefined;
  let deltaPct: number | null = null;
  let deltaAbs: number | null = null;
  if (hasDelta) {
    deltaAbs = value - previousValue;
    if (previousValue !== 0) {
      deltaPct = (deltaAbs / Math.abs(previousValue)) * 100;
    }
  }

  const isGood =
    deltaAbs === null
      ? null
      : invertSemantics
        ? deltaAbs < 0
        : deltaAbs > 0;
  const Arrow =
    deltaAbs === null || deltaAbs === 0 ? Minus : isGood ? ArrowUp : ArrowDown;
  const deltaClass =
    isGood === null
      ? 'text-[var(--fg-tertiary)]'
      : isGood
        ? 'text-[var(--gain)]'
        : 'text-[var(--loss)]';

  return (
    <div
      className={clsx('ds-card', highlight && 'shadow-card')}
      style={{
        padding: '18px 20px',
        ...(highlight ? { borderColor: 'var(--gain-border)' } : null),
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="t-label">{label}</div>
        {hasDelta && deltaPct !== null && (
          <span className={clsx('inline-flex items-center gap-0.5 t-num text-xs', deltaClass)}>
            <Arrow size={11} />
            {Math.abs(deltaPct).toFixed(1)}%
          </span>
        )}
      </div>

      <div
        className="t-num mb-3"
        style={{
          fontSize: highlight ? 24 : 22,
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: 'var(--fg-primary)',
        }}
      >
        {formatted}
      </div>

      {hasDelta ? (
        <div className="text-[11px]" style={{ color: 'var(--fg-tertiary)' }}>
          <span className="t-num">
            {isPercentage
              ? `${(previousValue ?? 0).toFixed(1)}%`
              : `${prefix}${fmt(previousValue ?? 0, periodo)}`}
          </span>
          {previousLabel && <span> · {previousLabel}</span>}
        </div>
      ) : (
        <div className="text-[11px] italic" style={{ color: 'var(--fg-quaternary)' }}>
          primer período cargado
        </div>
      )}
    </div>
  );
}

/** Helper used by the dashboard: takes a "vs Julio 2025" string from a periodo. */
export const prevPeriodLabel = (prevPeriodo: string): string => `vs ${fmtPeriodo(prevPeriodo)}`;
