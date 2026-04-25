import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronRight,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Equal,
  Loader2,
  Info,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/axios';
import { fmtMoney, fmtPeriodo } from '../lib/format';
import { PeriodSelector } from '../components/PeriodSelector';
import { MovementsModal } from '../components/MovementsModal';

type PnLCuenta = {
  numeroCuenta: string;
  nombreCuenta: string;
  saldo: number;
  debe: number;
  haber: number;
  movimientos: number;
};
type PnLSubrubro = { subrubro: string; total: number; cuentas: PnLCuenta[] };
type PnLBucket = { total: number; subrubros: PnLSubrubro[] };
type PnLResponse = {
  periodo: string;
  empresa: string | null;
  ingresos: PnLBucket;
  egresos: PnLBucket;
  resultadoNeto: number;
  filters: { includeAnulados: boolean };
  warnings: string[];
};

type DrillDownState = {
  title: string;
  subtitle: string;
  filters: {
    periodo: string;
    numeroCuentaReimputada?: string;
    subrubro?: string;
    rubroReimputada?: string;
  };
} | null;

export function ResultadosPage() {
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [includeAnulados, setIncludeAnulados] = useState(false);
  const [drilldown, setDrilldown] = useState<DrillDownState>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['pnl', periodo, includeAnulados],
    queryFn: async () =>
      (
        await api.get<PnLResponse>('/reports/pnl', {
          params: {
            periodo,
            includeAnulados: includeAnulados ? 'true' : 'false',
          },
        })
      ).data,
    enabled: !!periodo,
    staleTime: 30_000,
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Estado de Resultados</h2>
          <p className="text-sm text-slate-500 mt-1">
            P&L consolidado del período. Click en una cuenta para ver el detalle de movimientos.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <PeriodSelector value={periodo} onChange={setPeriodo} />
          <label className="text-xs text-slate-600 flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={includeAnulados}
              onChange={(e) => setIncludeAnulados(e.target.checked)}
              className="rounded"
            />
            Incluir anulaciones (retiros del dueño)
          </label>
        </div>
      </header>

      {!periodo && (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500">
          Elegí un período para ver el reporte.
        </div>
      )}

      {periodo && isLoading && (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      )}

      {periodo && error && (
        <div className="bg-red-50 border border-red-300 rounded-md p-4 text-sm text-red-700">
          Error al cargar el P&L para {periodo}.
        </div>
      )}

      {periodo && data && (
        <>
          {/* Summary header */}
          <div className="mb-6 flex items-baseline justify-between border-b border-slate-200 pb-3">
            <h3 className="text-lg font-medium text-slate-700">{fmtPeriodo(periodo)}</h3>
            <ResultadoNetoBadge value={data.resultadoNeto} />
          </div>

          <Section
            title="Ingresos"
            color="emerald"
            bucket={data.ingresos}
            rubroReimputada="Resultado positivo"
            periodo={periodo}
            onDrillCuenta={(c, sub) =>
              setDrilldown({
                title: `${c.numeroCuenta} — ${c.nombreCuenta}`,
                subtitle: `Subrubro: ${sub} · Período ${fmtPeriodo(periodo)}`,
                filters: { periodo, numeroCuentaReimputada: c.numeroCuenta },
              })
            }
            onDrillSubrubro={(sub) =>
              setDrilldown({
                title: sub.subrubro,
                subtitle: `${sub.cuentas.length} cuentas · ${fmtPeriodo(periodo)}`,
                filters: { periodo, subrubro: sub.subrubro, rubroReimputada: 'Resultado positivo' },
              })
            }
          />

          <Section
            title="Egresos"
            color="red"
            bucket={data.egresos}
            rubroReimputada="Resultado negativo"
            periodo={periodo}
            onDrillCuenta={(c, sub) =>
              setDrilldown({
                title: `${c.numeroCuenta} — ${c.nombreCuenta}`,
                subtitle: `Subrubro: ${sub} · Período ${fmtPeriodo(periodo)}`,
                filters: { periodo, numeroCuentaReimputada: c.numeroCuenta },
              })
            }
            onDrillSubrubro={(sub) =>
              setDrilldown({
                title: sub.subrubro,
                subtitle: `${sub.cuentas.length} cuentas · ${fmtPeriodo(periodo)}`,
                filters: { periodo, subrubro: sub.subrubro, rubroReimputada: 'Resultado negativo' },
              })
            }
          />

          {/* Final result row */}
          <div className="mt-6 bg-slate-50 border border-slate-300 rounded-md px-6 py-4 flex items-center justify-between">
            <span className="font-semibold text-slate-800">RESULTADO NETO</span>
            <span
              className={clsx(
                'text-2xl font-bold tabular-nums',
                data.resultadoNeto >= 0 ? 'text-emerald-700' : 'text-red-700',
              )}
            >
              $ {fmtMoney(data.resultadoNeto)}
            </span>
          </div>

          {includeAnulados && (
            <p className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-2">
              <Info size={14} /> Las anulaciones están incluidas (retiros tageados como
              "anulacion" en la BBDD). Quitá el toggle para ver el P&L "neto" usado en gestión.
            </p>
          )}
        </>
      )}

      {drilldown && (
        <MovementsModal
          open
          onClose={() => setDrilldown(null)}
          title={drilldown.title}
          subtitle={drilldown.subtitle}
          filters={drilldown.filters}
        />
      )}
    </div>
  );
}

// ─── Section (Ingresos / Egresos) ───────────────────────────────────────────

type SectionProps = {
  title: 'Ingresos' | 'Egresos';
  color: 'emerald' | 'red';
  bucket: PnLBucket;
  rubroReimputada: string;
  periodo: string;
  onDrillCuenta: (c: PnLCuenta, subrubro: string) => void;
  onDrillSubrubro: (sub: PnLSubrubro) => void;
};

function Section({ title, color, bucket, onDrillCuenta, onDrillSubrubro }: SectionProps) {
  const colorMap = {
    emerald: {
      header: 'bg-emerald-50 border-emerald-200',
      titleText: 'text-emerald-900',
      total: 'text-emerald-700',
    },
    red: {
      header: 'bg-red-50 border-red-200',
      titleText: 'text-red-900',
      total: 'text-red-700',
    },
  };
  const c = colorMap[color];

  return (
    <section className="mb-4 rounded-lg border border-slate-200 overflow-hidden">
      <header
        className={clsx(
          'px-4 py-2.5 border-b flex items-center justify-between',
          c.header,
        )}
      >
        <h3 className={clsx('font-semibold text-sm uppercase tracking-wide', c.titleText)}>
          {title}
        </h3>
        <span className={clsx('font-bold tabular-nums', c.total)}>$ {fmtMoney(bucket.total)}</span>
      </header>

      <div className="bg-white">
        {bucket.subrubros.length === 0 && (
          <div className="px-4 py-3 text-sm text-slate-400">Sin movimientos.</div>
        )}
        {bucket.subrubros.map((sub) => (
          <SubrubroRow
            key={sub.subrubro}
            sub={sub}
            onCuentaClick={(cuenta) => onDrillCuenta(cuenta, sub.subrubro)}
            onSubrubroClick={() => onDrillSubrubro(sub)}
          />
        ))}
      </div>
    </section>
  );
}

function SubrubroRow({
  sub,
  onCuentaClick,
  onSubrubroClick,
}: {
  sub: PnLSubrubro;
  onCuentaClick: (c: PnLCuenta) => void;
  onSubrubroClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div
        className="flex items-center px-4 py-2 hover:bg-slate-50 cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown size={14} className="text-slate-400 mr-1" />
        ) : (
          <ChevronRight size={14} className="text-slate-400 mr-1" />
        )}
        <span className="text-sm text-slate-700 flex-1">{sub.subrubro}</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSubrubroClick();
          }}
          className="text-xs text-slate-400 hover:text-brand-600 mr-3"
          title="Ver todos los movimientos del subrubro"
        >
          {sub.cuentas.length} cuentas
        </button>
        <span className="font-medium tabular-nums text-slate-800 min-w-[140px] text-right">
          $ {fmtMoney(sub.total)}
        </span>
      </div>

      {open && (
        <div className="bg-slate-50/50">
          {sub.cuentas.map((c) => (
            <button
              key={c.numeroCuenta}
              type="button"
              onClick={() => onCuentaClick(c)}
              className="w-full flex items-center px-4 py-1.5 pl-12 hover:bg-white text-left group"
            >
              <span className="text-xs font-mono text-slate-400 mr-2 w-12">
                {c.numeroCuenta}
              </span>
              <span className="text-xs text-slate-600 flex-1 group-hover:text-brand-700">
                {c.nombreCuenta}
              </span>
              <span className="text-xs text-slate-400 mr-3">{c.movimientos} movs</span>
              <span className="text-xs tabular-nums text-slate-700 min-w-[140px] text-right">
                $ {fmtMoney(c.saldo)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultadoNetoBadge({ value }: { value: number }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Equal;
  const color = value > 0 ? 'text-emerald-700' : value < 0 ? 'text-red-700' : 'text-slate-500';
  return (
    <div className={clsx('flex items-center gap-2 text-sm', color)}>
      <Icon size={16} />
      <span>Resultado neto:</span>
      <strong className="tabular-nums">$ {fmtMoney(value)}</strong>
    </div>
  );
}
