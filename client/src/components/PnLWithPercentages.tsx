import clsx from 'clsx';
import { useCurrency } from '../context/CurrencyContext';

type SubrubroRow = {
  subrubro: string;
  total: number;
};

export type PnLWithPercentagesProps = {
  ingresos: { total: number; subrubros: SubrubroRow[] };
  egresos: { total: number; subrubros: SubrubroRow[] };
  resultadoNeto: number;
  /** Denominator for the % column. Per Sebastián: only "Venta de mercaderías". */
  ventas: number;
  /** Optional previous period for the Δ column. Match by subrubro name. */
  prevIngresos?: SubrubroRow[];
  prevEgresos?: SubrubroRow[];
  prevVentas?: number;
  prevResultadoNeto?: number;
  /** Period for currency conversion (MM/YYYY). */
  periodo?: string | null;
};

/**
 * Compact P&L for the dashboard. Shows three columns:
 *  - Monto (signed: ingresos +, egresos -)
 *  - % sobre Ventas (denominator = ventas, not total ingresos)
 *  - Δ vs mes anterior (% change of the same line)
 *
 * Not expandable — for the detail view the user goes to /resultados.
 */
export function PnLWithPercentages({
  ingresos,
  egresos,
  resultadoNeto,
  ventas,
  prevIngresos,
  prevEgresos,
  prevVentas,
  prevResultadoNeto,
  periodo,
}: PnLWithPercentagesProps) {
  const { fmt, currency } = useCurrency();
  const prefix = currency === 'USD' ? '' : '$ ';
  const hasPrev =
    prevIngresos !== undefined ||
    prevEgresos !== undefined ||
    prevResultadoNeto !== undefined;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr className="text-left text-xs text-slate-600 uppercase tracking-wide">
            <th className="px-4 py-2 font-medium">Línea</th>
            <th className="px-4 py-2 font-medium text-right">Monto</th>
            <th className="px-4 py-2 font-medium text-right w-24">% s/Ventas</th>
            {hasPrev && (
              <th className="px-4 py-2 font-medium text-right w-28">Δ vs mes ant.</th>
            )}
          </tr>
        </thead>
        <tbody>
          {/* INGRESOS section header */}
          <tr className="bg-emerald-50/50 border-y border-emerald-100">
            <td colSpan={hasPrev ? 4 : 3} className="px-4 py-1.5 text-xs font-semibold text-emerald-900 uppercase tracking-wide">
              Ingresos
            </td>
          </tr>
          {ingresos.subrubros.map((s) => (
            <Row
              key={s.subrubro}
              label={s.subrubro}
              value={s.total}
              ventas={ventas}
              prev={prevIngresos?.find((p) => p.subrubro === s.subrubro)?.total}
              prevVentas={prevVentas}
              hasPrev={hasPrev}
              periodo={periodo}
              fmt={fmt}
              prefix={prefix}
            />
          ))}
          <Row
            label="Total Ingresos"
            value={ingresos.total}
            ventas={ventas}
            prev={prevIngresos?.reduce((s, r) => s + r.total, 0)}
            prevVentas={prevVentas}
            hasPrev={hasPrev}
            bold
            periodo={periodo}
            fmt={fmt}
            prefix={prefix}
          />

          {/* EGRESOS section header */}
          <tr className="bg-red-50/50 border-y border-red-100">
            <td colSpan={hasPrev ? 4 : 3} className="px-4 py-1.5 text-xs font-semibold text-red-900 uppercase tracking-wide">
              Egresos
            </td>
          </tr>
          {egresos.subrubros.map((s) => (
            <Row
              key={s.subrubro}
              label={s.subrubro}
              value={s.total}
              ventas={ventas}
              prev={prevEgresos?.find((p) => p.subrubro === s.subrubro)?.total}
              prevVentas={prevVentas}
              hasPrev={hasPrev}
              isCost
              periodo={periodo}
              fmt={fmt}
              prefix={prefix}
            />
          ))}
          <Row
            label="Total Egresos"
            value={egresos.total}
            ventas={ventas}
            prev={prevEgresos?.reduce((s, r) => s + r.total, 0)}
            prevVentas={prevVentas}
            hasPrev={hasPrev}
            isCost
            bold
            periodo={periodo}
            fmt={fmt}
            prefix={prefix}
          />

          {/* RESULTADO NETO */}
          <tr className="bg-slate-50 border-t-2 border-slate-300">
            <td className="px-4 py-2.5 font-semibold text-slate-800">Resultado neto</td>
            <td
              className={clsx(
                'px-4 py-2.5 text-right font-bold tabular-nums',
                resultadoNeto >= 0 ? 'text-emerald-700' : 'text-red-700',
              )}
            >
              {prefix}{fmt(resultadoNeto, periodo)}
            </td>
            <td className="px-4 py-2.5 text-right font-medium text-slate-700 tabular-nums">
              {ventas !== 0 ? `${((resultadoNeto / ventas) * 100).toFixed(1)}%` : '—'}
            </td>
            {hasPrev && (
              <td className="px-4 py-2.5 text-right tabular-nums">
                <Delta value={resultadoNeto} previous={prevResultadoNeto ?? null} />
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Row helper ─────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  ventas,
  prev,
  prevVentas,
  hasPrev,
  isCost,
  bold,
  periodo,
  fmt,
  prefix,
}: {
  label: string;
  value: number;
  ventas: number;
  prev?: number;
  prevVentas?: number;
  hasPrev: boolean;
  isCost?: boolean;
  bold?: boolean;
  periodo?: string | null;
  fmt: (v: number, p: string | null | undefined) => string;
  prefix: string;
}) {
  const pct = ventas !== 0 ? (value / ventas) * 100 : null;
  // For costs we display % as positive (it's "weight on sales", not direction).
  const displayPct = pct === null ? null : isCost ? Math.abs(pct) : pct;
  // Suppress prev info if the line did not exist last month (prev=undefined)
  // versus existed but was 0 (prev=0). The diff matters: undefined → no Δ shown.
  const prevExisted = prev !== undefined;
  void prevVentas;
  return (
    <tr className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40">
      <td
        className={clsx(
          'px-4 py-1.5 text-slate-700',
          bold && 'font-semibold pl-4',
          !bold && 'pl-8',
        )}
      >
        {label}
      </td>
      <td
        className={clsx(
          'px-4 py-1.5 text-right tabular-nums',
          bold ? 'font-semibold text-slate-900' : 'text-slate-700',
        )}
      >
        {prefix}{fmt(value, periodo)}
      </td>
      <td className="px-4 py-1.5 text-right text-slate-600 tabular-nums">
        {displayPct === null ? '—' : `${displayPct.toFixed(1)}%`}
      </td>
      {hasPrev && (
        <td className="px-4 py-1.5 text-right tabular-nums">
          {prevExisted ? <Delta value={value} previous={prev!} invertSemantics={isCost} /> : <span className="text-slate-300">—</span>}
        </td>
      )}
    </tr>
  );
}

function Delta({
  value,
  previous,
  invertSemantics,
}: {
  value: number;
  previous: number | null;
  invertSemantics?: boolean;
}) {
  if (previous === null) return <span className="text-slate-300">—</span>;
  const abs = value - previous;
  if (previous === 0) {
    return <span className="text-slate-400">n/a</span>;
  }
  const pct = (abs / Math.abs(previous)) * 100;
  // Color: positive change = green, unless invertSemantics (cost lines).
  const isGood = invertSemantics ? abs < 0 : abs > 0;
  const color = abs === 0 ? 'text-slate-400' : isGood ? 'text-emerald-700' : 'text-red-700';
  const sign = pct > 0 ? '+' : '';
  return (
    <span className={clsx('font-medium', color)}>
      {sign}
      {pct.toFixed(1)}%
    </span>
  );
}
