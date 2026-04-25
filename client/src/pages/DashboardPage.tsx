import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Database } from 'lucide-react';
import { api } from '../lib/axios';
import { fmtPeriodo } from '../lib/format';
import { PeriodSelector } from '../components/PeriodSelector';
import { KPICard, prevPeriodLabel } from '../components/KPICard';
import { EvolutionChart } from '../components/EvolutionChart';
import { PnLWithPercentages } from '../components/PnLWithPercentages';

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
type EvolucionResponse = { count: number; serie: EvolucionPoint[] };

export function DashboardPage() {
  const [periodo, setPeriodo] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['evolucion'],
    queryFn: async () => (await api.get<EvolucionResponse>('/reports/evolucion')).data,
    staleTime: 30_000,
  });

  // Find the selected period in the series + the immediately prior one.
  const { current, previous } = useMemo(() => {
    if (!data || !periodo) return { current: null, previous: null };
    const idx = data.serie.findIndex((p) => p.periodo === periodo);
    if (idx < 0) return { current: null, previous: null };
    return {
      current: data.serie[idx],
      previous: idx > 0 ? data.serie[idx - 1] : null,
    };
  }, [data, periodo]);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Dashboard</h2>
          <p className="text-sm text-slate-500 mt-1">
            Resumen ejecutivo del cierre mensual con KPIs, evolución y P&L con porcentajes.
          </p>
        </div>
        <PeriodSelector value={periodo} onChange={setPeriodo} />
      </header>

      {isLoading && (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-300 rounded-md p-4 text-sm text-red-700">
          Error al cargar la evolución.
        </div>
      )}

      {data && data.serie.length === 0 && (
        <EmptyState />
      )}

      {data && current && (
        <>
          {/* KPIs */}
          <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
            <KPICard
              label="Ventas"
              value={current.ventas}
              previousValue={previous?.ventas}
              previousLabel={previous ? prevPeriodLabel(previous.periodo) : undefined}
              highlight
              periodo={current.periodo}
            />
            <KPICard
              label="CMV ajustado"
              value={current.cmvAjustado}
              previousValue={previous?.cmvAjustado}
              previousLabel={previous ? prevPeriodLabel(previous.periodo) : undefined}
              invertSemantics
              periodo={current.periodo}
            />
            <KPICard
              label="Resultado neto"
              value={current.resultadoNeto}
              previousValue={previous?.resultadoNeto}
              previousLabel={previous ? prevPeriodLabel(previous.periodo) : undefined}
              highlight
              periodo={current.periodo}
            />
            <KPICard
              label="Margen bruto"
              value={
                current.ventas !== 0
                  ? ((current.ventas - current.cmvAjustado) / current.ventas) * 100
                  : 0
              }
              previousValue={
                previous && previous.ventas !== 0
                  ? ((previous.ventas - previous.cmvAjustado) / previous.ventas) * 100
                  : null
              }
              previousLabel={previous ? prevPeriodLabel(previous.periodo) : undefined}
              isPercentage
            />
            <KPICard
              label="Margen neto"
              value={
                current.ventas !== 0
                  ? (current.resultadoNeto / current.ventas) * 100
                  : 0
              }
              previousValue={
                previous && previous.ventas !== 0
                  ? (previous.resultadoNeto / previous.ventas) * 100
                  : null
              }
              previousLabel={previous ? prevPeriodLabel(previous.periodo) : undefined}
              isPercentage
            />
          </section>

          {/* Evolution chart */}
          <section className="bg-white rounded-lg border border-slate-200 p-5 mb-6">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-base font-semibold text-slate-800">Evolución mensual</h3>
              <span className="text-xs text-slate-500">{data.count} períodos cargados</span>
            </div>
            <EvolutionChart serie={data.serie} />
          </section>

          {/* P&L with % */}
          <section className="mb-6">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-base font-semibold text-slate-800">
                Estado de resultados — {fmtPeriodo(current.periodo)}
              </h3>
              <a
                href="/resultados"
                className="text-xs text-brand-600 hover:text-brand-700"
              >
                Ver detalle expandible →
              </a>
            </div>
            <PnLWithPercentages
              ingresos={{ total: current.ingresosTotal, subrubros: current.subrubrosIngreso }}
              egresos={{ total: current.egresosTotal, subrubros: current.subrubrosEgreso }}
              resultadoNeto={current.resultadoNeto}
              ventas={current.ventas}
              prevIngresos={previous?.subrubrosIngreso}
              prevEgresos={previous?.subrubrosEgreso}
              prevVentas={previous?.ventas}
              prevResultadoNeto={previous?.resultadoNeto}
              periodo={current.periodo}
            />
          </section>
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white rounded-lg border border-dashed border-slate-300 p-12 text-center">
      <Database size={32} className="text-slate-300 mx-auto mb-3" />
      <p className="text-sm text-slate-600 font-medium mb-1">Aún no hay datos cargados</p>
      <p className="text-xs text-slate-500">
        Andá a <a href="/ingesta" className="text-brand-600 hover:underline">Ingesta</a> y subí el primer cierre mensual para ver el dashboard.
      </p>
    </div>
  );
}
