import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
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
  /** How to extract the value from a point. */
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
    color: 'oklch(0.72 0.16 260)', // neutral indigo
    defaultOn: true,
    pick: (p) => p.ventas,
  },
  {
    key: 'cmvAjustado',
    label: 'CMV ajustado',
    color: 'oklch(0.70 0.21 25)', // loss
    defaultOn: true,
    pick: (p) => p.cmvAjustado,
  },
  {
    key: 'resultadoNeto',
    label: 'Resultado neto',
    color: 'oklch(0.78 0.18 152)', // gain
    defaultOn: true,
    pick: (p) => p.resultadoNeto,
  },
  {
    key: 'gastosAdministrativos',
    label: 'Gastos admin.',
    color: 'oklch(0.72 0.16 290)', // violet
    defaultOn: false,
    pick: (p) => findSubrubro(p, 'egreso', 'Gastos administrativos'),
  },
  {
    key: 'cif',
    label: 'CIF',
    color: 'oklch(0.82 0.16 85)', // amber
    defaultOn: false,
    pick: (p) => findSubrubro(p, 'egreso', 'CIF'),
  },
  {
    key: 'resultadosFinancieros',
    label: 'Result. financieros',
    color: 'oklch(0.72 0.14 230)', // sky
    defaultOn: false,
    pick: (p) => findSubrubro(p, 'ingreso', 'Resultados financieros'),
  },
];

export function EvolutionChart({ serie }: EvolutionChartProps) {
  const { convert, currency } = useCurrency();
  const prefix = currency === 'USD' ? 'USD ' : '$ ';

  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>(() =>
    SERIES.reduce(
      (acc, s) => ({ ...acc, [s.key]: s.defaultOn }),
      {} as Record<SeriesKey, boolean>,
    ),
  );

  // Pivot the data — convert to USD if needed (null = no rate, keep ARS).
  const data = serie.map((p) => {
    const row: Record<string, number | string> = { periodo: fmtPeriodo(p.periodo) };
    for (const s of SERIES) {
      const ars = s.pick(p);
      const converted = convert(ars, p.periodo);
      row[s.key] = converted ?? ars;
    }
    return row;
  });

  if (serie.length === 0) {
    return (
      <div className="text-center text-slate-500 text-sm py-8">
        No hay datos para graficar.
      </div>
    );
  }

  if (serie.length === 1) {
    return (
      <div className="text-center text-slate-500 text-sm py-8">
        Solo hay 1 período cargado — el gráfico de evolución necesita al menos 2 períodos.
        Cargá otro mes para ver tendencias.
      </div>
    );
  }

  return (
    <div>
      {/* Toggles */}
      <div className="flex flex-wrap gap-2 mb-4">
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

      <div className="w-full h-72">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.012 255 / 0.3)" />
            <XAxis
              dataKey="periodo"
              stroke="oklch(0.58 0.010 255)"
              tick={{ fontSize: 12, fill: 'oklch(0.58 0.010 255)' }}
              tickLine={{ stroke: 'oklch(0.30 0.012 255 / 0.3)' }}
              axisLine={{ stroke: 'oklch(0.30 0.012 255 / 0.3)' }}
            />
            <YAxis
              stroke="oklch(0.58 0.010 255)"
              tick={{ fontSize: 11, fill: 'oklch(0.58 0.010 255)' }}
              tickLine={{ stroke: 'oklch(0.30 0.012 255 / 0.3)' }}
              axisLine={{ stroke: 'oklch(0.30 0.012 255 / 0.3)' }}
              tickFormatter={(v: number) => fmtMoneyCompact(v)}
              width={60}
            />
            <Tooltip
              formatter={(v) => (typeof v === 'number' ? `${prefix}${fmtMoneyCompact(v)}` : String(v))}
              labelStyle={{ color: 'var(--fg-primary)', fontWeight: 500 }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                border: '1px solid var(--border)',
                background: 'var(--bg-elevated)',
                color: 'var(--fg-primary)',
              }}
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
        </ResponsiveContainer>
      </div>
    </div>
  );
}
