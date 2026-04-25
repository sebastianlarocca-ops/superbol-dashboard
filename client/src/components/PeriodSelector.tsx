import { useQuery } from '@tanstack/react-query';
import { Calendar, Loader2 } from 'lucide-react';
import { api } from '../lib/axios';
import { fmtPeriodo } from '../lib/format';

type PeriodosResponse = {
  count: number;
  periodos: { periodo: string; createdAt: string; movs: number }[];
};

export type PeriodSelectorProps = {
  value: string | null;
  onChange: (periodo: string) => void;
};

/**
 * Period dropdown populated from /reports/periodos. Auto-selects the most
 * recent period when no value is set yet.
 */
export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports-periodos'],
    queryFn: async () => (await api.get<PeriodosResponse>('/reports/periodos')).data,
    staleTime: 60_000,
  });

  // When the list arrives and we don't have a value yet, pick the first one.
  if (data && data.periodos.length > 0 && !value) {
    queueMicrotask(() => onChange(data.periodos[0].periodo));
  }

  return (
    <div className="flex items-center gap-2">
      <Calendar size={16} className="text-slate-500" />
      <label htmlFor="periodo-select" className="text-sm text-slate-600">
        Período:
      </label>
      {isLoading ? (
        <span className="text-sm text-slate-400 flex items-center gap-1">
          <Loader2 size={14} className="animate-spin" /> cargando…
        </span>
      ) : error ? (
        <span className="text-sm text-red-600">Error al cargar períodos</span>
      ) : data && data.periodos.length === 0 ? (
        <span className="text-sm text-slate-500">
          Sin períodos cargados — andá a Ingesta
        </span>
      ) : (
        <select
          id="periodo-select"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="px-3 py-1.5 border border-slate-300 rounded-md text-sm bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {data?.periodos.map((p) => (
            <option key={p.periodo} value={p.periodo}>
              {fmtPeriodo(p.periodo)} ({p.movs.toLocaleString()} movs)
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
