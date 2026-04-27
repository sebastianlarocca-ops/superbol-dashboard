import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Database, ArrowUp, ArrowDown, Sparkles } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/axios';
import { fmtPeriodo } from '../lib/format';
import { useCurrency } from '../context/CurrencyContext';
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
    <div className="ds-fade-in" style={{ padding: '28px 36px 80px', maxWidth: 1380, margin: '0 auto' }}>
      <header className="ds-page-header">
        <div>
          <h1 className="ds-page-title">Dashboard</h1>
          <p className="ds-page-subtitle">
            Resumen ejecutivo del cierre mensual con KPIs, evolución y P&L con porcentajes.
          </p>
        </div>
        <PeriodSelector value={periodo} onChange={setPeriodo} />
      </header>

      {isLoading && <LoadingCard />}

      {error && (
        <div className="ds-card ds-card-pad" style={{ borderColor: 'var(--loss-border)' }}>
          <span style={{ color: 'var(--loss)' }}>Error al cargar la evolución.</span>
        </div>
      )}

      {data && data.serie.length === 0 && <EmptyState />}

      {data && current && (
        <>
          <HeroCard current={current} previous={previous} />

          {/* KPIs */}
          <section
            className="grid gap-3 mb-5"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}
          >
            <KPICard
              label="Ventas"
              value={current.ventas}
              previousValue={previous?.ventas}
              previousLabel={previous ? prevPeriodLabel(previous.periodo) : undefined}
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
          <section className="ds-card mb-5">
            <div className="ds-card-head">
              <div>
                <h3 className="ds-card-title">Evolución mensual</h3>
                <div className="text-xs mt-0.5" style={{ color: 'var(--fg-tertiary)' }}>
                  {data.count} períodos cargados
                </div>
              </div>
              <Sparkles size={13} style={{ color: 'var(--fg-tertiary)' }} />
            </div>
            <div style={{ padding: '16px 18px 12px' }}>
              <EvolutionChart serie={data.serie} />
            </div>
          </section>

          {/* P&L with % */}
          <section className="mb-5">
            <div className="flex items-baseline justify-between mb-3">
              <h3
                className="t-display"
                style={{ fontSize: 16, color: 'var(--fg-primary)' }}
              >
                Estado de resultados — {fmtPeriodo(current.periodo)}
              </h3>
              <a
                href="/resultados"
                className="text-xs hover:underline"
                style={{ color: 'var(--neutral)' }}
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

// ─── HeroCard ──────────────────────────────────────────────────────────────

function HeroCard({
  current,
  previous,
}: {
  current: EvolucionPoint;
  previous: EvolucionPoint | null;
}) {
  const { fmt, currency } = useCurrency();
  const prefix = currency === 'USD' ? '' : '$';

  const deltaPct =
    previous && previous.resultadoNeto !== 0
      ? ((current.resultadoNeto - previous.resultadoNeto) / Math.abs(previous.resultadoNeto)) * 100
      : null;
  const positive = current.resultadoNeto >= 0;
  const deltaPositive = deltaPct !== null && deltaPct >= 0;

  return (
    <div
      className="ds-card relative overflow-hidden mb-5"
      style={{ padding: '28px 32px' }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -120,
          right: -80,
          width: 480,
          height: 480,
          background: positive
            ? 'radial-gradient(circle, oklch(0.78 0.18 152 / 0.10), transparent 60%)'
            : 'radial-gradient(circle, oklch(0.70 0.21 25 / 0.10), transparent 60%)',
          pointerEvents: 'none',
        }}
      />
      <div className="relative">
        <div className="t-label">Resultado neto · {fmtPeriodo(current.periodo)}</div>
        <div
          className="t-num t-display"
          style={{
            fontSize: 56,
            margin: '12px 0 14px',
            letterSpacing: '-0.035em',
            fontWeight: 600,
            lineHeight: 1.05,
          }}
        >
          <span
            style={{ color: 'var(--fg-tertiary)', marginRight: 4, fontWeight: 400 }}
          >
            {prefix}
          </span>
          {fmt(current.resultadoNeto, current.periodo)}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {deltaPct !== null ? (
            <span
              className={clsx('ds-chip', deltaPositive ? 'ds-chip-gain' : 'ds-chip-loss')}
            >
              {deltaPositive ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
              {deltaPositive ? '+' : ''}
              {deltaPct.toFixed(1)}%
            </span>
          ) : (
            <span className="ds-chip">primer período</span>
          )}
          {previous && (
            <span style={{ color: 'var(--fg-tertiary)', fontSize: 12.5 }}>
              vs {fmtPeriodo(previous.periodo)}
            </span>
          )}
          {previous && (
            <>
              <span style={{ color: 'var(--fg-quaternary)' }}>·</span>
              <span style={{ color: 'var(--fg-secondary)', fontSize: 12.5 }}>
                Ventas: {prefix}
                {fmt(current.ventas, current.periodo)}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── States ────────────────────────────────────────────────────────────────

function LoadingCard() {
  return (
    <div
      className="ds-card flex items-center justify-center gap-2"
      style={{ padding: 48, color: 'var(--fg-tertiary)' }}
    >
      <Loader2 size={16} className="animate-spin" /> Cargando…
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="ds-card text-center"
      style={{
        padding: 48,
        borderStyle: 'dashed',
        borderColor: 'var(--border)',
      }}
    >
      <Database size={32} style={{ color: 'var(--fg-quaternary)', margin: '0 auto 12px' }} />
      <p className="text-sm font-medium mb-1" style={{ color: 'var(--fg-secondary)' }}>
        Aún no hay datos cargados
      </p>
      <p className="text-xs" style={{ color: 'var(--fg-tertiary)' }}>
        Andá a{' '}
        <a href="/ingesta" style={{ color: 'var(--neutral)' }} className="hover:underline">
          Ingesta
        </a>{' '}
        y subí el primer cierre mensual para ver el dashboard.
      </p>
    </div>
  );
}
