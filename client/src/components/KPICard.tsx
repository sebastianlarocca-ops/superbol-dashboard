import clsx from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
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
  /** Used to highlight one or two flagship KPIs. */
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

  // Color logic
  const isGood =
    deltaAbs === null
      ? null
      : invertSemantics
        ? deltaAbs < 0 // for costs, less is better
        : deltaAbs > 0;
  const Icon =
    deltaAbs === null || deltaAbs === 0 ? Minus : isGood ? TrendingUp : TrendingDown;
  const deltaColor =
    isGood === null
      ? 'text-slate-400'
      : isGood
        ? 'text-emerald-700'
        : 'text-red-700';

  return (
    <div
      className={clsx(
        'rounded-lg border p-4 bg-white',
        highlight ? 'border-brand-300 shadow-sm' : 'border-slate-200',
      )}
    >
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div
        className={clsx(
          'text-2xl font-bold tabular-nums mb-1',
          highlight ? 'text-brand-800' : 'text-slate-900',
        )}
      >
        {formatted}
      </div>
      {hasDelta ? (
        <div className={clsx('flex items-center gap-1 text-xs', deltaColor)}>
          <Icon size={12} />
          <span className="font-medium tabular-nums">
            {deltaPct === null
              ? '—'
              : `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)}%`}
          </span>
          <span className="text-slate-500">
            ({isPercentage
              ? `${(previousValue ?? 0).toFixed(1)}%`
              : `${prefix}${fmt(previousValue ?? 0, periodo)}`}
            {previousLabel && ` · ${previousLabel}`})
          </span>
        </div>
      ) : (
        <div className="text-xs text-slate-400 italic">primer período cargado</div>
      )}
    </div>
  );
}

/** Helper used by the dashboard: takes a "vs Julio 2025" string from a periodo. */
export const prevPeriodLabel = (prevPeriodo: string): string => `vs ${fmtPeriodo(prevPeriodo)}`;
