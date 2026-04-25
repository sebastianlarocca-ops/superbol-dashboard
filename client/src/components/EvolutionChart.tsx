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
import { fmtMoneyCompact, fmtMoney, fmtPeriodo } from '../lib/format';

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
    color: '#0284c7', // brand-600
    defaultOn: true,
    pick: (p) => p.ventas,
  },
  {
    key: 'cmvAjustado',
    label: 'CMV ajustado',
    color: '#dc2626', // red-600
    defaultOn: true,
    pick: (p) => p.cmvAjustado,
  },
  {
    key: 'resultadoNeto',
    label: 'Resultado neto',
    color: '#059669', // emerald-600
    defaultOn: true,
    pick: (p) => p.resultadoNeto,
  },
  {
    key: 'gastosAdministrativos',
    label: 'Gastos admin.',
    color: '#9333ea', // purple-600
    defaultOn: false,
    pick: (p) => findSubrubro(p, 'egreso', 'Gastos administrativos'),
  },
  {
    key: 'cif',
    label: 'CIF',
    color: '#ea580c', // orange-600
    defaultOn: false,
    pick: (p) => findSubrubro(p, 'egreso', 'CIF'),
  },
  {
    key: 'resultadosFinancieros',
    label: 'Result. financieros',
    color: '#0891b2', // cyan-600
    defaultOn: false,
    pick: (p) => findSubrubro(p, 'ingreso', 'Resultados financieros'),
  },
];

export function EvolutionChart({ serie }: EvolutionChartProps) {
  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>(() =>
    SERIES.reduce(
      (acc, s) => ({ ...acc, [s.key]: s.defaultOn }),
      {} as Record<SeriesKey, boolean>,
    ),
  );

  // Pivot the data to one row per period with one column per enabled series.
  const data = serie.map((p) => {
    const row: Record<string, number | string> = { periodo: fmtPeriodo(p.periodo) };
    for (const s of SERIES) {
      row[s.key] = s.pick(p);
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
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="periodo" stroke="#64748b" tick={{ fontSize: 12 }} />
            <YAxis
              stroke="#64748b"
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) => fmtMoneyCompact(v)}
              width={60}
            />
            <Tooltip
              formatter={(v) => (typeof v === 'number' ? `$ ${fmtMoney(v)}` : String(v))}
              labelStyle={{ color: '#0f172a', fontWeight: 500 }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid #e2e8f0',
              }}
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
