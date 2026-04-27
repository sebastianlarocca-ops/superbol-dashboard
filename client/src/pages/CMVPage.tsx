import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import {
  Loader2,
  Plus,
  Minus,
  Equal,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Info,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/axios';
import { fmtMoneyCompact, fmtPeriodo } from '../lib/format';
import { useCurrency } from '../context/CurrencyContext';
import { PeriodSelector } from '../components/PeriodSelector';

type CMVItem = {
  _id: string;
  categoria: string;
  unidMesAnterior: number;
  precioMesAnterior: number;
  valorMesAnterior: number;
  unidMesEnCurso: number;
  precioMesEnCurso: number;
  valorMesEnCurso: number;
  deltaPrecio: number;
  casoCalculado: 'A' | 'B';
  unidadesAfectadas: number;
  costoFinanciero: number;
  mermaPct: number | null;
};

type CMVResponse = {
  periodo: string;
  batchId: string;
  totals: {
    stockInicial: number;
    compras: number;
    stockFinal: number;
    cmvBruto: number;
    costoFinanciero: number;
    cmvAjustado: number;
  };
  items: CMVItem[];
  topGanancias: CMVItem[];
  topPerdidas: CMVItem[];
};

type SortKey = keyof Pick<
  CMVItem,
  | 'categoria'
  | 'valorMesAnterior'
  | 'valorMesEnCurso'
  | 'deltaPrecio'
  | 'costoFinanciero'
>;

export function CMVPage() {
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('costoFinanciero');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { data, isLoading, error } = useQuery({
    queryKey: ['cmv', periodo],
    queryFn: async () =>
      (await api.get<CMVResponse>(`/reports/cmv?periodo=${periodo}`)).data,
    enabled: !!periodo,
    staleTime: 30_000,
  });

  return (
    <div className="ds-fade-in" style={{ padding: '28px 36px 80px', maxWidth: 1380, margin: '0 auto' }}>
      <header className="ds-page-header">
        <div>
          <h1 className="ds-page-title">Costo de Mercadería Vendida</h1>
          <p className="ds-page-subtitle">
            Cálculo CMV con composición del costo financiero por categoría.
          </p>
        </div>
        <PeriodSelector value={periodo} onChange={setPeriodo} />
      </header>

      {!periodo && (
        <EmptyMessage text="Elegí un período para ver el cálculo del CMV." />
      )}

      {periodo && isLoading && (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500 flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      )}

      {periodo && error && (
        <div className="bg-red-50 border border-red-300 rounded-md p-4 text-sm text-red-700">
          Error al cargar el CMV para {periodo}.
        </div>
      )}

      {periodo && data && data.items.length === 0 && (
        <EmptyMessage
          text={`No hay inventario cargado para ${fmtPeriodo(periodo)}. Re-ingestá el período si esperabas tener datos.`}
        />
      )}

      {periodo && data && data.items.length > 0 && (
        <>
          {/* Period title */}
          <div className="mb-6 pb-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <h3 className="t-display" style={{ fontSize: 18, color: 'var(--fg-primary)' }}>
              {fmtPeriodo(periodo)}
            </h3>
          </div>

          {/* Formula block */}
          <FormulaBlock totals={data.totals} periodo={periodo} />

          {/* How costo financiero is computed */}
          <CostoFinancieroExplainer />

          {/* Top movers */}
          <TopMovers
            ganancias={data.topGanancias}
            perdidas={data.topPerdidas}
            allItems={data.items}
            costoFinancieroTotal={data.totals.costoFinanciero}
            periodo={periodo}
          />

          {/* Bar chart */}
          <section className="bg-white rounded-lg border border-slate-200 p-5 mb-6">
            <h4 className="text-base font-semibold text-slate-800 mb-3">
              Costo financiero por categoría
            </h4>
            <CFChart items={data.items} periodo={periodo} />
          </section>

          {/* Items table */}
          <section className="bg-white rounded-lg border border-slate-200 overflow-hidden mb-6">
            <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h4 className="text-base font-semibold text-slate-800">
                Detalle por categoría ({data.items.length})
              </h4>
              <span className="text-xs text-slate-500">
                Ordenado por <strong>{LABEL[sortKey]}</strong> {sortDir === 'desc' ? '↓' : '↑'}
              </span>
            </header>
            <ItemsTable
              items={data.items}
              cfTotal={data.totals.costoFinanciero}
              sortKey={sortKey}
              sortDir={sortDir}
              periodo={periodo}
              onSort={(k) => {
                if (k === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
                else {
                  setSortKey(k);
                  setSortDir('desc');
                }
              }}
            />
          </section>
        </>
      )}
    </div>
  );
}

const LABEL: Record<SortKey, string> = {
  categoria: 'categoría',
  valorMesAnterior: 'SI',
  valorMesEnCurso: 'SF',
  deltaPrecio: 'Δ precio',
  costoFinanciero: 'costo financiero',
};

// ─── Formula block ──────────────────────────────────────────────────────────

function FormulaBlock({ totals, periodo }: { totals: CMVResponse['totals']; periodo: string }) {
  const cfSign = totals.costoFinanciero;
  return (
    <section className="bg-white rounded-lg border border-slate-200 p-5 mb-6">
      <h4 className="text-base font-semibold text-slate-800 mb-4">Cálculo</h4>
      {/* Row 1: SI + Compras - SF = CMV Bruto */}
      <div className="flex flex-wrap items-stretch gap-3 mb-3">
        <FormulaTile label="Stock Inicial (SI)" value={totals.stockInicial} periodo={periodo} />
        <Operator icon={Plus} />
        <FormulaTile label="Compras" value={totals.compras} hint="cuentas 1600 + 1620 + 6200" periodo={periodo} />
        <Operator icon={Minus} />
        <FormulaTile label="Stock Final (SF)" value={totals.stockFinal} periodo={periodo} />
        <Operator icon={Equal} />
        <FormulaTile label="CMV Bruto" value={totals.cmvBruto} highlight periodo={periodo} />
      </div>
      {/* Row 2: CMV Bruto - cf = CMV Ajustado */}
      <div className="flex flex-wrap items-stretch gap-3">
        <FormulaTile label="CMV Bruto" value={totals.cmvBruto} muted periodo={periodo} />
        <Operator icon={Minus} />
        <FormulaTile
          label="Costo Financiero"
          value={totals.costoFinanciero}
          hint={cfSign > 0 ? 'ganancia → reduce CMV' : cfSign < 0 ? 'pérdida → aumenta CMV' : ''}
          accentColor={cfSign > 0 ? 'emerald' : cfSign < 0 ? 'red' : 'slate'}
          periodo={periodo}
        />
        <Operator icon={Equal} />
        <FormulaTile label="CMV Ajustado" value={totals.cmvAjustado} highlight finalLine periodo={periodo} />
      </div>
    </section>
  );
}

function FormulaTile({
  label,
  value,
  hint,
  highlight,
  muted,
  finalLine,
  accentColor,
  periodo,
}: {
  label: string;
  value: number;
  hint?: string;
  highlight?: boolean;
  muted?: boolean;
  finalLine?: boolean;
  accentColor?: 'emerald' | 'red' | 'slate';
  periodo: string;
}) {
  const { fmt, currency } = useCurrency();
  const prefix = currency === 'USD' ? '' : '$ ';
  return (
    <div
      className={clsx(
        'flex-1 min-w-[140px] rounded-md px-3 py-2 border',
        highlight && finalLine && 'bg-brand-100 border-brand-400',
        highlight && !finalLine && 'bg-brand-50 border-brand-300',
        muted && 'bg-slate-50 border-slate-200 opacity-70',
        !highlight && !muted && accentColor === 'emerald' && 'bg-emerald-50 border-emerald-200',
        !highlight && !muted && accentColor === 'red' && 'bg-red-50 border-red-200',
        !highlight && !muted && (!accentColor || accentColor === 'slate') && 'bg-white border-slate-200',
      )}
    >
      <div className="text-xs text-slate-600 mb-0.5">{label}</div>
      <div
        className={clsx(
          'font-bold tabular-nums',
          finalLine ? 'text-xl' : 'text-base',
          highlight ? 'text-brand-900' : 'text-slate-800',
        )}
      >
        {prefix}{fmt(value, periodo)}
      </div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5 italic">{hint}</div>}
    </div>
  );
}

function Operator({ icon: Icon }: { icon: typeof Plus }) {
  return (
    <div className="flex items-center text-slate-400">
      <Icon size={20} />
    </div>
  );
}

// ─── Costo financiero explainer ─────────────────────────────────────────────

/**
 * Educational callout that surfaces the meaning of caso A / B and the
 * direction of the financial result. Permanent (not collapsible) so a
 * first-time user doesn't have to discover it. Compact enough to not be
 * visual noise.
 */
function CostoFinancieroExplainer() {
  return (
    <section className="bg-sky-50 border border-sky-200 rounded-lg p-4 mb-6">
      <header className="flex items-start gap-2 mb-3">
        <Info size={16} className="text-sky-700 mt-0.5 shrink-0" />
        <div>
          <h4 className="text-sm font-semibold text-sky-900">
            Cómo se calcula el costo financiero
          </h4>
          <p className="text-xs text-sky-800 mt-0.5">
            Mide la ganancia o pérdida por <strong>tenencia de inventario</strong>: cuánto se
            revalorizó (o desvalorizó) el stock que pasó de un mes al otro debido al cambio de
            precio unitario. Se aplica por categoría y luego se suma.
          </p>
        </div>
      </header>

      <div className="grid md:grid-cols-2 gap-3 ml-6">
        <div className="bg-white rounded-md border border-sky-200 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-700 rounded font-mono">
              A
            </span>
            <span className="text-xs font-semibold text-slate-800">SI &gt; SF</span>
            <span className="text-xs text-slate-500">(el stock se achicó)</span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">
            Las <strong>SF unidades</strong> son las que sobrevivieron del mes anterior, así que
            son las que se revalorizan.
          </p>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            cf = SF × (precio<sub>actual</sub> − precio<sub>anterior</sub>)
          </p>
        </div>

        <div className="bg-white rounded-md border border-sky-200 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-700 rounded font-mono">
              B
            </span>
            <span className="text-xs font-semibold text-slate-800">SI ≤ SF</span>
            <span className="text-xs text-slate-500">(el stock creció o se mantuvo)</span>
          </div>
          <p className="text-xs text-slate-700 leading-relaxed">
            De las SF unidades, solo las primeras <strong>SI</strong> son "viejas"; las nuevas
            entraron a precio actual y no aportan al costo financiero.
          </p>
          <p className="text-xs text-slate-500 mt-1 font-mono">
            cf = SI × (precio<sub>actual</sub> − precio<sub>anterior</sub>)
          </p>
        </div>
      </div>

      <p className="text-xs text-sky-800 mt-3 ml-6">
        <strong>Signo:</strong> + (ganancia) si el precio subió → reduce el CMV y se contabiliza
        como ingreso por tenencia. − (pérdida) si bajó → aumenta el CMV.
      </p>
    </section>
  );
}

// ─── Top movers ─────────────────────────────────────────────────────────────

function TopMovers({
  ganancias,
  perdidas,
  allItems,
  costoFinancieroTotal,
  periodo,
}: {
  ganancias: CMVItem[];
  perdidas: CMVItem[];
  allItems: CMVItem[];
  costoFinancieroTotal: number;
  periodo: string;
}) {
  const { fmt, currency } = useCurrency();
  const prefix = currency === 'USD' ? '' : '$ ';
  const ganadores = allItems.filter((i) => i.costoFinanciero > 0).length;
  const perdedores = allItems.filter((i) => i.costoFinanciero < 0).length;
  const neutros = allItems.length - ganadores - perdedores;

  return (
    <section className="grid md:grid-cols-2 gap-4 mb-6">
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <header className="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
            <TrendingUp size={14} /> Top ganancias
          </h4>
          <span className="text-xs text-emerald-700">
            {ganadores} categoría{ganadores !== 1 ? 's' : ''}
          </span>
        </header>
        <ul className="divide-y divide-slate-100 text-sm">
          {ganancias.length === 0 ? (
            <li className="px-4 py-3 text-slate-400">Sin ganancias en el período</li>
          ) : (
            ganancias.map((it) => (
              <MoverRow key={it._id} item={it} positive periodo={periodo} />
            ))
          )}
        </ul>
      </div>

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <header className="px-4 py-2.5 bg-red-50 border-b border-red-200 flex items-center justify-between">
          <h4 className="text-sm font-semibold text-red-900 flex items-center gap-2">
            <TrendingDown size={14} /> Top pérdidas
          </h4>
          <span className="text-xs text-red-700">
            {perdedores} categoría{perdedores !== 1 ? 's' : ''}
          </span>
        </header>
        <ul className="divide-y divide-slate-100 text-sm">
          {perdidas.length === 0 ? (
            <li className="px-4 py-3 text-slate-400">Sin pérdidas en el período</li>
          ) : (
            perdidas.map((it) => (
              <MoverRow key={it._id} item={it} positive={false} periodo={periodo} />
            ))
          )}
        </ul>
      </div>

      {/* Summary line spanning both columns */}
      <div className="md:col-span-2 text-xs text-slate-500 text-center">
        {ganadores} ganadores · {perdedores} perdedores · {neutros} neutros · Costo financiero
        neto: <strong className={costoFinancieroTotal >= 0 ? 'text-emerald-700' : 'text-red-700'}>{prefix}{fmt(costoFinancieroTotal, periodo)}</strong>
      </div>
    </section>
  );
}

function MoverRow({ item, positive, periodo }: { item: CMVItem; positive: boolean; periodo: string }) {
  const { fmt, currency } = useCurrency();
  const prefix = currency === 'USD' ? '' : '$ ';
  const casoTitle =
    item.casoCalculado === 'A'
      ? 'Caso A: SI > SF — stock se achicó, cf = SF × Δprecio'
      : 'Caso B: SI ≤ SF — stock creció o se mantuvo, cf = SI × Δprecio';
  return (
    <li className="px-4 py-2 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-slate-800 font-medium truncate">{item.categoria}</div>
        <div className="text-xs text-slate-500">
          Δp = {prefix}{fmt(item.deltaPrecio, periodo)} · {item.unidadesAfectadas.toLocaleString()} unid ·{' '}
          <span className="cursor-help underline decoration-dotted" title={casoTitle}>
            caso {item.casoCalculado}
          </span>
        </div>
      </div>
      <div
        className={clsx(
          'font-semibold tabular-nums whitespace-nowrap',
          positive ? 'text-emerald-700' : 'text-red-700',
        )}
      >
        {prefix}{fmt(item.costoFinanciero, periodo)}
      </div>
    </li>
  );
}

// ─── Bar chart (divergent) ──────────────────────────────────────────────────

function CFChart({ items, periodo }: { items: CMVItem[]; periodo: string }) {
  const { fmt, currency } = useCurrency();
  const prefix = currency === 'USD' ? '' : '$ ';
  // Sort by cf desc and trim to non-zero
  const data = useMemo(
    () =>
      [...items]
        .filter((it) => it.costoFinanciero !== 0)
        .sort((a, b) => b.costoFinanciero - a.costoFinanciero)
        .map((it) => ({
          categoria: it.categoria,
          cf: it.costoFinanciero,
        })),
    [items],
  );

  if (data.length === 0) {
    return <p className="text-sm text-slate-500 py-6 text-center">Todos los costos financieros son 0.</p>;
  }

  // Dynamic height: 22px per row, min 200, max 800
  const height = Math.max(200, Math.min(800, data.length * 22));

  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 8, right: 24, left: 8, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.30 0.012 255 / 0.3)" horizontal={false} />
          <XAxis
            type="number"
            stroke="oklch(0.58 0.010 255)"
            tick={{ fontSize: 11, fill: 'oklch(0.58 0.010 255)' }}
            tickLine={{ stroke: 'oklch(0.30 0.012 255 / 0.3)' }}
            axisLine={{ stroke: 'oklch(0.30 0.012 255 / 0.3)' }}
            tickFormatter={(v: number) => fmtMoneyCompact(v)}
          />
          <YAxis
            type="category"
            dataKey="categoria"
            stroke="oklch(0.58 0.010 255)"
            tick={{ fontSize: 10, fill: 'oklch(0.78 0.008 255)' }}
            tickLine={{ stroke: 'oklch(0.30 0.012 255 / 0.3)' }}
            axisLine={{ stroke: 'oklch(0.30 0.012 255 / 0.3)' }}
            width={200}
          />
          <Tooltip
            formatter={(v) =>
              typeof v === 'number' ? `${prefix}${fmt(v, periodo)}` : String(v)
            }
            contentStyle={{
              fontSize: 12,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg-elevated)',
              color: 'var(--fg-primary)',
            }}
            cursor={{ fill: 'oklch(0.30 0.012 255 / 0.3)' }}
          />
          <ReferenceLine x={0} stroke="oklch(0.58 0.010 255)" />
          <Bar dataKey="cf" name="Costo financiero" isAnimationActive={false}>
            {data.map((d) => (
              <Cell
                key={d.categoria}
                fill={d.cf >= 0 ? 'oklch(0.78 0.18 152)' : 'oklch(0.70 0.21 25)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Items table ────────────────────────────────────────────────────────────

function ItemsTable({
  items,
  cfTotal,
  sortKey,
  sortDir,
  periodo,
  onSort,
}: {
  items: CMVItem[];
  cfTotal: number;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  periodo: string;
  onSort: (k: SortKey) => void;
}) {
  const { fmt, currency } = useCurrency();
  const prefix = currency === 'USD' ? '' : '$ ';
  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === 'asc' ? an - bn : bn - an;
    });
    return arr;
  }, [items, sortKey, sortDir]);

  return (
    <table className="w-full text-xs">
      <thead className="bg-slate-50 border-b border-slate-200">
        <tr className="text-slate-600">
          <SortableHeader col="categoria" current={sortKey} dir={sortDir} onClick={onSort} align="left">
            Categoría
          </SortableHeader>
          <SortableHeader col="valorMesAnterior" current={sortKey} dir={sortDir} onClick={onSort} align="right">
            SI ($)
          </SortableHeader>
          <SortableHeader col="valorMesEnCurso" current={sortKey} dir={sortDir} onClick={onSort} align="right">
            SF ($)
          </SortableHeader>
          <SortableHeader col="deltaPrecio" current={sortKey} dir={sortDir} onClick={onSort} align="right">
            Δ Precio
          </SortableHeader>
          <th className="px-3 py-2 font-medium text-center">Caso</th>
          <th className="px-3 py-2 font-medium text-right">Unid. afect.</th>
          <SortableHeader col="costoFinanciero" current={sortKey} dir={sortDir} onClick={onSort} align="right">
            Costo financiero
          </SortableHeader>
          <th className="px-3 py-2 font-medium text-right w-16">% del total</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((it) => {
          const pct = cfTotal !== 0 ? (it.costoFinanciero / cfTotal) * 100 : 0;
          return (
            <tr key={it._id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40">
              <td className="px-3 py-1.5 text-slate-800 font-medium">{it.categoria}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                {prefix}{fmt(it.valorMesAnterior, periodo)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                {prefix}{fmt(it.valorMesEnCurso, periodo)}
              </td>
              <td
                className={clsx(
                  'px-3 py-1.5 text-right tabular-nums',
                  it.deltaPrecio > 0
                    ? 'text-emerald-700'
                    : it.deltaPrecio < 0
                      ? 'text-red-700'
                      : 'text-slate-500',
                )}
              >
                {prefix}{fmt(it.deltaPrecio, periodo)}
              </td>
              <td className="px-3 py-1.5 text-center">
                <span
                  className="inline-block px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-700 rounded font-mono cursor-help"
                  title={
                    it.casoCalculado === 'A'
                      ? 'Caso A: SI > SF — stock se achicó, cf = SF × Δprecio'
                      : 'Caso B: SI ≤ SF — stock creció o se mantuvo, cf = SI × Δprecio'
                  }
                >
                  {it.casoCalculado}
                </span>
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                {it.unidadesAfectadas.toLocaleString()}
              </td>
              <td
                className={clsx(
                  'px-3 py-1.5 text-right tabular-nums font-semibold',
                  it.costoFinanciero > 0
                    ? 'text-emerald-700'
                    : it.costoFinanciero < 0
                      ? 'text-red-700'
                      : 'text-slate-500',
                )}
              >
                {prefix}{fmt(it.costoFinanciero, periodo)}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                {pct.toFixed(1)}%
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function SortableHeader({
  col,
  current,
  dir,
  onClick,
  align,
  children,
}: {
  col: SortKey;
  current: SortKey;
  dir: 'asc' | 'desc';
  onClick: (k: SortKey) => void;
  align: 'left' | 'right';
  children: React.ReactNode;
}) {
  const Icon = col !== current ? ArrowUpDown : dir === 'desc' ? ArrowDown : ArrowUp;
  return (
    <th
      onClick={() => onClick(col)}
      className={clsx(
        'px-3 py-2 font-medium cursor-pointer hover:bg-slate-100 select-none',
        align === 'left' ? 'text-left' : 'text-right',
      )}
    >
      <span className="inline-flex items-center gap-1">
        {align === 'right' && <Icon size={11} className="text-slate-400" />}
        {children}
        {align === 'left' && <Icon size={11} className="text-slate-400" />}
      </span>
    </th>
  );
}

// ─── EmptyMessage ───────────────────────────────────────────────────────────

function EmptyMessage({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500 text-sm">
      {text}
    </div>
  );
}
