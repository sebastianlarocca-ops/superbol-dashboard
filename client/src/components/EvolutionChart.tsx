import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import clsx from 'clsx';
import { fmtMoneyCompact, fmtPeriodo } from '../lib/format';
import { useCurrency } from '../context/CurrencyContext';

type EvolucionPoint = {
  periodo: string;
  ventas: number;
  cmvAjustado: number;
  resultadoNeto: number;
  ingresosTotal: number;
  egresosTotal: number;
  subrubrosIngreso: { subrubro: string; total: number }[];
  subrubrosEgreso: { subrubro: string; total: number }[];
};

export type EvolutionChartProps = {
  serie: EvolucionPoint[];
};

// ─── Lines mode ─────────────────────────────────────────────────────────────

type SeriesKey =
  | 'ventas'
  | 'cmvAjustado'
  | 'resultadoNeto'
  | 'gastosAdministrativos'
  | 'cif'
  | 'resultadosFinancieros';

type SeriesDef = {
  key: SeriesKey;
  label: string;
  color: string;
  defaultOn: boolean;
  pick: (p: EvolucionPoint) => number;
};

const findSubrubro = (
  point: EvolucionPoint,
  bucket: 'ingreso' | 'egreso',
  name: string,
): number => {
  const list = bucket === 'ingreso' ? point.subrubrosIngreso : point.subrubrosEgreso;
  return list.find((s) => s.subrubro === name)?.total ?? 0;
};

const SERIES: SeriesDef[] = [
  {
    key: 'ventas',
    label: 'Ventas',
    color: 'oklch(0.72 0.16 260)',
    defaultOn: true,
    pick: (p) => p.ventas,
  },
  {
    key: 'cmvAjustado',
    label: 'CMV ajustado',
    color: 'oklch(0.70 0.21 25)',
    defaultOn: true,
    pick: (p) => p.cmvAjustado,
  },
  {
    key: 'resultadoNeto',
    label: 'Resultado neto',
    color: 'oklch(0.78 0.18 152)',
    defaultOn: true,
    pick: (p) => p.resultadoNeto,
  },
  {
    key: 'gastosAdministrativos',
    label: 'Gastos admin.',
    color: 'oklch(0.72 0.16 290)',
    defaultOn: false,
    pick: (p) => findSubrubro(p, 'egreso', 'Gastos administrativos'),
  },
  {
    key: 'cif',
    label: 'CIF',
    color: 'oklch(0.82 0.16 85)',
    defaultOn: false,
    pick: (p) => findSubrubro(p, 'egreso', 'CIF'),
  },
  {
    key: 'resultadosFinancieros',
    label: 'Result. financieros',
    color: 'oklch(0.72 0.14 230)',
    defaultOn: false,
    pick: (p) => findSubrubro(p, 'ingreso', 'Resultados financieros'),
  },
];

// ─── Stacked bars mode ───────────────────────────────────────────────────────

const INGRESO_PALETTE = [
  'oklch(0.78 0.18 152)',
  'oklch(0.68 0.17 158)',
  'oklch(0.60 0.15 163)',
  'oklch(0.84 0.13 148)',
  'oklch(0.55 0.14 170)',
  'oklch(0.72 0.16 142)',
];

const EGRESO_PALETTE = [
  'oklch(0.70 0.21 25)',
  'oklch(0.62 0.19 32)',
  'oklch(0.78 0.16 40)',
  'oklch(0.55 0.20 18)',
  'oklch(0.82 0.14 50)',
  'oklch(0.65 0.18 28)',
];

// ─── Shared axis / tooltip styles ────────────────────────────────────────────

const AXIS_TICK = { fontSize: 12, fill: 'oklch(0.58 0.010 255)' };
const AXIS_LINE = { stroke: 'oklch(0.30 0.012 255 / 0.3)' };
const GRID_DASH = '3 3';
const GRID_COLOR = 'oklch(0.30 0.012 255 / 0.3)';

function tooltipStyle() {
  return {
    fontSize: 12,
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    color: 'var(--fg-primary)',
  };
}

// ─── Main component ──────────────────────────────────────────────────────────

export function EvolutionChart({ serie }: EvolutionChartProps) {
  const { convert, currency } = useCurrency();
  const prefix = currency === 'USD' ? 'USD ' : '$ ';

  const [mode, setMode] = useState<'lines' | 'bars'>('lines');

  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>(() =>
    SERIES.reduce(
      (acc, s) => ({ ...acc, [s.key]: s.defaultOn }),
      {} as Record<SeriesKey, boolean>,
    ),
  );

  // ── Lines data ──
  const linesData = serie.map((p) => {
    const row: Record<string, number | string> = { periodo: fmtPeriodo(p.periodo) };
    for (const s of SERIES) {
      const ars = s.pick(p);
      row[s.key] = convert(ars, p.periodo) ?? ars;
    }
    return row;
  });

  // ── Bars data ──
  const allIngresoSubs = useMemo(() => {
    const set = new Set<string>();
    for (const p of serie) for (const s of p.subrubrosIngreso) set.add(s.subrubro);
    return Array.from(set);
  }, [serie]);

  const allEgresoSubs = useMemo(() => {
    const set = new Set<string>();
    for (const p of serie) for (const s of p.subrubrosEgreso) set.add(s.subrubro);
    return Array.from(set);
  }, [serie]);

  const barsData = useMemo(
    () =>
      serie.map((p) => {
        const row: Record<string, number | string> = { periodo: fmtPeriodo(p.periodo) };
        for (const sub of allIngresoSubs) {
          const ars = p.subrubrosIngreso.find((s) => s.subrubro === sub)?.total ?? 0;
          row[`ing__${sub}`] = convert(ars, p.periodo) ?? ars;
        }
        for (const sub of allEgresoSubs) {
          const ars = p.subrubrosEgreso.find((s) => s.subrubro === sub)?.total ?? 0;
          // negative so egresos stack below the zero line
          row[`egr__${sub}`] = -(convert(ars, p.periodo) ?? ars);
        }
        const rn = convert(p.resultadoNeto, p.periodo) ?? p.resultadoNeto;
        row['resultadoNeto'] = rn;
        return row;
      }),
    [serie, allIngresoSubs, allEgresoSubs, convert],
  );

  // ── Empty / single-period guards ──
  if (serie.length === 0) {
    return (
      <div className="text-center text-sm py-8" style={{ color: 'var(--fg-tertiary)' }}>
        No hay datos para graficar.
      </div>
    );
  }

  if (mode === 'lines' && serie.length === 1) {
    return (
      <div className="text-center text-sm py-8" style={{ color: 'var(--fg-tertiary)' }}>
        Solo hay 1 período cargado — el gráfico de evolución necesita al menos 2 períodos.
        Cargá otro mes para ver tendencias.
      </div>
    );
  }

  return (
    <div>
      {/* ── Controls row ── */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        {/* Series toggles — only in lines mode */}
        {mode === 'lines' && (
          <div className="flex flex-wrap gap-2">
            {SERIES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setEnabled((prev) => ({ ...prev, [s.key]: !prev[s.key] }))}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors',
                  enabled[s.key]
                    ? 'bg-slate-50 border-slate-300 text-slate-800'
                    : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600',
                )}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: enabled[s.key] ? s.color : '#cbd5e1' }}
                />
                {s.label}
              </button>
            ))}
          </div>
        )}

        {mode === 'bars' && (
          <p className="text-xs" style={{ color: 'var(--fg-tertiary)', lineHeight: 1.6 }}>
            Verde → ingresos por subrubro · Rojo → egresos · Línea → resultado neto
          </p>
        )}

        {/* Mode toggle — pinned to the right */}
        <div
          className="flex rounded-md overflow-hidden border ml-auto shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          {(['lines', 'bars'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={clsx(
                'px-3 py-1 text-xs font-medium transition-colors',
                mode === m
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-500 hover:bg-slate-50',
              )}
            >
              {m === 'lines' ? 'Líneas' : 'Barras'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chart ── */}
      <div className="w-full h-72">
        <ResponsiveContainer>
          {mode === 'lines' ? (
            <LineChart data={linesData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray={GRID_DASH} stroke={GRID_COLOR} />
              <XAxis
                dataKey="periodo"
                stroke={AXIS_LINE.stroke}
                tick={AXIS_TICK}
                tickLine={AXIS_LINE}
                axisLine={AXIS_LINE}
              />
              <YAxis
                stroke={AXIS_LINE.stroke}
                tick={AXIS_TICK}
                tickLine={AXIS_LINE}
                axisLine={AXIS_LINE}
                tickFormatter={(v: number) => fmtMoneyCompact(v)}
                width={60}
              />
              <Tooltip
                formatter={(v) =>
                  typeof v === 'number' ? `${prefix}${fmtMoneyCompact(v)}` : String(v)
                }
                labelStyle={{ color: 'var(--fg-primary)', fontWeight: 500 }}
                contentStyle={tooltipStyle()}
                cursor={{ stroke: 'var(--border-strong)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {SERIES.filter((s) => enabled[s.key]).map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <ComposedChart data={barsData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray={GRID_DASH} stroke={GRID_COLOR} />
              <XAxis
                dataKey="periodo"
                stroke={AXIS_LINE.stroke}
                tick={AXIS_TICK}
                tickLine={AXIS_LINE}
                axisLine={AXIS_LINE}
              />
              <YAxis
                stroke={AXIS_LINE.stroke}
                tick={AXIS_TICK}
                tickLine={AXIS_LINE}
                axisLine={AXIS_LINE}
                tickFormatter={(v: number) => fmtMoneyCompact(Math.abs(v))}
                width={60}
              />
              <Tooltip
                formatter={(v, name) => {
                  const abs = Math.abs(Number(v));
                  const label = String(name).startsWith('egr__')
                    ? String(name).slice(5)
                    : String(name).startsWith('ing__')
                      ? String(name).slice(5)
                      : String(name);
                  return [`${prefix}${fmtMoneyCompact(abs)}`, label];
                }}
                labelStyle={{ color: 'var(--fg-primary)', fontWeight: 500 }}
                contentStyle={tooltipStyle()}
                cursor={{ fill: 'oklch(0.30 0.012 255 / 0.06)' }}
              />
              <ReferenceLine y={0} stroke="var(--border-strong)" strokeWidth={1} />

              {allIngresoSubs.map((sub, i) => (
                <Bar
                  key={`ing__${sub}`}
                  dataKey={`ing__${sub}`}
                  name={sub}
                  stackId="ing"
                  fill={INGRESO_PALETTE[i % INGRESO_PALETTE.length]}
                  isAnimationActive={false}
                />
              ))}

              {allEgresoSubs.map((sub, i) => (
                <Bar
                  key={`egr__${sub}`}
                  dataKey={`egr__${sub}`}
                  name={sub}
                  stackId="egr"
                  fill={EGRESO_PALETTE[i % EGRESO_PALETTE.length]}
                  isAnimationActive={false}
                />
              ))}

              <Line
                type="monotone"
                dataKey="resultadoNeto"
                name="Resultado neto"
                stroke="oklch(0.85 0.12 88)"
                strokeWidth={2.5}
                dot={{ r: 4, fill: 'oklch(0.85 0.12 88)', strokeWidth: 0 }}
                activeDot={{ r: 6 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
