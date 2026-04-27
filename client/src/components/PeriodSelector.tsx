import { useQuery } from '@tanstack/react-query';
import { Calendar, Loader2, ChevronDown } from 'lucide-react';
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

  if (data && data.periodos.length > 0 && !value) {
    queueMicrotask(() => onChange(data.periodos[0].periodo));
  }

  if (isLoading) {
    return (
      <span className="ds-chip">
        <Loader2 size={12} className="animate-spin" /> cargando…
      </span>
    );
  }

  if (error) {
    return <span className="ds-chip ds-chip-loss">Error al cargar períodos</span>;
  }

  if (data && data.periodos.length === 0) {
    return <span className="ds-chip">Sin períodos cargados — andá a Ingesta</span>;
  }

  return (
    <label className="ds-btn ds-btn-ghost relative cursor-pointer" style={{ paddingRight: 28 }}>
      <Calendar size={13} />
      <span style={{ color: 'var(--fg-secondary)' }}>Período:</span>
      <span style={{ color: 'var(--fg-primary)' }}>
        {value ? fmtPeriodo(value) : '—'}
      </span>
      <ChevronDown
        size={12}
        className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: 'var(--fg-tertiary)' }}
      />
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer"
      >
        {data?.periodos.map((p) => (
          <option key={p.periodo} value={p.periodo}>
            {fmtPeriodo(p.periodo)} ({p.movs.toLocaleString()} movs)
          </option>
        ))}
      </select>
    </label>
  );
}
