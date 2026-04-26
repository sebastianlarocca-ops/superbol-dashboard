import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Filter, Loader2, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/axios';
import { fmtMoney, fmtPeriodo } from '../lib/format';
import { useCurrency } from '../context/CurrencyContext';

// ── Types ────────────────────────────────────────────────────────────────────

type Movement = {
  _id: string;
  empresa: string;
  periodo: string;
  fechaISO: string;
  asiento: number;
  numeroCuentaReimputada: string;
  nombreCuentaReimputada: string;
  nombreSubcuenta: string | null;
  detalle: string;
  debe: number;
  haber: number;
  anulacion: boolean;
};

type MovResponse = {
  total: number;
  offset: number;
  limit: number;
  count: number;
  totals: { debe: number; haber: number; saldo: number };
  movements: Movement[];
};

type PeriodoItem = { periodo: string };
type PeriodsResponse = { periodos: PeriodoItem[] };
type CuentaDistinct = { numero: string; nombre: string };

const PAGE_SIZE = 500;

// ── Helpers ──────────────────────────────────────────────────────────────────

function comparePeriodo(a: string, b: string): number {
  const [am, ay] = a.split('/').map(Number);
  const [bm, by] = b.split('/').map(Number);
  return ay !== by ? ay - by : am - bm;
}

// ── MultiSelectFilter ────────────────────────────────────────────────────────

type MultiSelectFilterProps = {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  isLoading: boolean;
  isActive: boolean;
};

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  isLoading,
  isActive,
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );

  // selected=[] means "all visible" (no filter). selected=[...] means whitelist.
  const isChecked = (id: string) => selected.length === 0 || selected.includes(id);

  const toggle = (id: string) => {
    if (selected.length === 0) {
      // All showing → deselect this one = keep all except this one
      onChange(options.map((o) => o.id).filter((o) => o !== id));
    } else if (selected.includes(id)) {
      const next = selected.filter((s) => s !== id);
      // If nothing left selected, clear filter
      onChange(next.length === 0 ? [] : next);
    } else {
      const next = [...selected, id];
      // If all are now selected, clear filter
      onChange(next.length === options.length ? [] : next);
    }
  };

  return (
    <div ref={ref} className="relative inline-flex items-center gap-1">
      <span>{label}</span>
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'p-0.5 rounded transition-colors',
          isActive ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600',
        )}
        title={`Filtrar por ${label}`}
      >
        <Filter size={11} />
      </button>
      {isActive && (
        <button
          onClick={() => onChange([])}
          className="p-0.5 rounded text-amber-500 hover:text-red-500"
          title="Limpiar filtro"
        >
          <X size={10} />
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-72 bg-white border border-slate-200 rounded-md shadow-lg">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              type="text"
              placeholder="Buscar…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-brand-500"
            />
          </div>
          {isLoading ? (
            <div className="p-4 text-center text-slate-400">
              <Loader2 size={14} className="animate-spin inline" />
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto">
              <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-xs font-medium text-slate-600 border-b border-slate-100">
                <input
                  type="checkbox"
                  checked={selected.length === 0}
                  onChange={() => onChange([])}
                  className="rounded"
                />
                (Todos)
              </label>
              {filtered.map((o) => (
                <label
                  key={o.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-xs text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={isChecked(o.id)}
                    onChange={() => toggle(o.id)}
                    className="rounded flex-shrink-0"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-3 text-xs text-slate-400 text-center">Sin resultados</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TextFilter ───────────────────────────────────────────────────────────────

type TextFilterProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  isActive: boolean;
};

function TextFilter({ label, value, onChange, isActive }: TextFilterProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onChange(draft);
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, draft, onChange]);

  return (
    <div ref={ref} className="relative inline-flex items-center gap-1">
      <span>{label}</span>
      <button
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'p-0.5 rounded transition-colors',
          isActive ? 'text-amber-500' : 'text-slate-400 hover:text-slate-600',
        )}
        title={`Filtrar por ${label}`}
      >
        <Filter size={11} />
      </button>
      {isActive && (
        <button
          onClick={() => { onChange(''); setDraft(''); }}
          className="p-0.5 rounded text-amber-500 hover:text-red-500"
          title="Limpiar filtro"
        >
          <X size={10} />
        </button>
      )}
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-56 bg-white border border-slate-200 rounded-md shadow-lg p-2">
          <input
            autoFocus
            type="text"
            placeholder="Contiene…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { onChange(draft); setOpen(false); }
              if (e.key === 'Escape') { setDraft(value); setOpen(false); }
            }}
            className="w-full text-xs border border-slate-200 rounded px-2 py-1 outline-none focus:border-brand-500"
          />
          <p className="text-[10px] text-slate-400 mt-1">Enter para aplicar · Esc para cancelar</p>
        </div>
      )}
    </div>
  );
}

// ── MovimientosPage ──────────────────────────────────────────────────────────

export function MovimientosPage() {
  const { fmt, currency } = useCurrency();

  const [periodoDesde, setPeriodoDesde] = useState<string | null>(null);
  const [periodoHasta, setPeriodoHasta] = useState<string | null>(null);
  const [selectedCuentas, setSelectedCuentas] = useState<string[]>([]);
  const [selectedSubcuentas, setSelectedSubcuentas] = useState<string[]>([]);
  const [detalleFilter, setDetalleFilter] = useState('');
  const [page, setPage] = useState(0);

  const { data: periodsData } = useQuery({
    queryKey: ['periodos'],
    queryFn: async () => (await api.get<PeriodsResponse>('/reports/periodos')).data,
    staleTime: 60_000,
  });

  // Set defaults once periods load: desde = earliest, hasta = most recent
  useEffect(() => {
    if (!periodsData?.periodos.length) return;
    const sorted = [...periodsData.periodos].sort((a, b) =>
      comparePeriodo(a.periodo, b.periodo),
    );
    if (!periodoDesde) setPeriodoDesde(sorted[0].periodo);
    if (!periodoHasta) setPeriodoHasta(sorted[sorted.length - 1].periodo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodsData]);

  const rangeReady = !!(periodoDesde && periodoHasta);
  const rangeValid = rangeReady && comparePeriodo(periodoDesde!, periodoHasta!) <= 0;

  // Distinct values for column filter dropdowns
  const distParams = rangeReady
    ? new URLSearchParams({ periodoDesde: periodoDesde!, periodoHasta: periodoHasta! }).toString()
    : '';

  const { data: cuentasDistinct, isLoading: cuentasLoading } = useQuery({
    queryKey: ['movements-distinct-cuenta', distParams],
    queryFn: async () =>
      (await api.get<{ values: CuentaDistinct[] }>(`/reports/movements/distinct/cuenta?${distParams}`)).data,
    enabled: rangeValid,
    staleTime: 60_000,
  });

  const { data: subcuentasDistinct, isLoading: subcuentasLoading } = useQuery({
    queryKey: ['movements-distinct-subcuenta', distParams],
    queryFn: async () =>
      (await api.get<{ values: string[] }>(`/reports/movements/distinct/subcuenta?${distParams}`)).data,
    enabled: rangeValid,
    staleTime: 60_000,
  });

  // Main movements query
  const movParams = new URLSearchParams();
  if (periodoDesde) movParams.set('periodoDesde', periodoDesde);
  if (periodoHasta) movParams.set('periodoHasta', periodoHasta);
  movParams.set('limit', String(PAGE_SIZE));
  movParams.set('offset', String(page * PAGE_SIZE));
  if (selectedCuentas.length) movParams.set('cuentas', selectedCuentas.join(','));
  if (selectedSubcuentas.length) movParams.set('subcuentas', selectedSubcuentas.join(','));
  if (detalleFilter) movParams.set('detalle', detalleFilter);

  const { data, isLoading, error } = useQuery({
    queryKey: ['movimientos', movParams.toString()],
    queryFn: async () =>
      (await api.get<MovResponse>(`/reports/movements?${movParams}`)).data,
    enabled: rangeValid,
    staleTime: 30_000,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const resetPage = () => setPage(0);

  const sortedPeriodsAsc = periodsData
    ? [...periodsData.periodos].sort((a, b) => comparePeriodo(a.periodo, b.periodo))
    : [];
  const sortedPeriodsDesc = [...sortedPeriodsAsc].reverse();

  const cuentaOptions = (cuentasDistinct?.values ?? []).map((c) => ({
    id: c.numero,
    label: `${c.numero} ${c.nombre}`,
  }));
  const subcuentaOptions = (subcuentasDistinct?.values ?? []).map((s) => ({
    id: s,
    label: s,
  }));

  return (
    <div className="flex flex-col h-full">
      {/* Period range + header */}
      <header className="px-6 py-4 border-b border-slate-200 bg-white flex items-center gap-4 flex-shrink-0 flex-wrap">
        <h1 className="text-lg font-semibold text-slate-900 mr-2">Movimientos</h1>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          Desde
          <select
            value={periodoDesde ?? ''}
            onChange={(e) => { setPeriodoDesde(e.target.value); resetPage(); }}
            className="border border-slate-200 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:border-brand-500"
          >
            {sortedPeriodsAsc.map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {fmtPeriodo(p.periodo)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          Hasta
          <select
            value={periodoHasta ?? ''}
            onChange={(e) => { setPeriodoHasta(e.target.value); resetPage(); }}
            className="border border-slate-200 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:border-brand-500"
          >
            {sortedPeriodsDesc.map((p) => (
              <option key={p.periodo} value={p.periodo}>
                {fmtPeriodo(p.periodo)}
              </option>
            ))}
          </select>
        </label>

        {!rangeValid && rangeReady && (
          <span className="text-xs text-red-600">"Desde" debe ser anterior o igual a "Hasta"</span>
        )}

        {data && (
          <span className="ml-auto text-xs text-slate-400 tabular-nums">
            {data.total.toLocaleString('es-AR')} movimientos
          </span>
        )}
      </header>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2">
            <Loader2 size={18} className="animate-spin" /> Cargando…
          </div>
        )}
        {error && (
          <div className="p-8 text-center text-red-600 text-sm">
            Error al cargar movimientos.
          </div>
        )}
        {!isLoading && rangeValid && data?.movements.length === 0 && (
          <div className="p-12 text-center text-slate-400 text-sm">
            Sin movimientos para los filtros seleccionados.
          </div>
        )}
        {data && data.movements.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead className="bg-slate-50 sticky top-0 z-20">
              <tr className="text-left text-slate-600 text-[11px]">
                <th className="px-3 py-2 font-medium border-b border-slate-200 whitespace-nowrap">
                  Fecha
                </th>
                <th className="px-3 py-2 font-medium border-b border-slate-200 whitespace-nowrap">
                  Asiento
                </th>
                <th className="px-3 py-2 font-medium border-b border-slate-200 whitespace-nowrap">
                  <MultiSelectFilter
                    label="Cuenta orig."
                    options={cuentaOptions}
                    selected={selectedCuentas}
                    onChange={(v) => { setSelectedCuentas(v); resetPage(); }}
                    isLoading={cuentasLoading}
                    isActive={selectedCuentas.length > 0}
                  />
                </th>
                <th className="px-3 py-2 font-medium border-b border-slate-200 whitespace-nowrap">
                  <MultiSelectFilter
                    label="Subcuenta"
                    options={subcuentaOptions}
                    selected={selectedSubcuentas}
                    onChange={(v) => { setSelectedSubcuentas(v); resetPage(); }}
                    isLoading={subcuentasLoading}
                    isActive={selectedSubcuentas.length > 0}
                  />
                </th>
                <th className="px-3 py-2 font-medium border-b border-slate-200">
                  <TextFilter
                    label="Detalle"
                    value={detalleFilter}
                    onChange={(v) => { setDetalleFilter(v); resetPage(); }}
                    isActive={!!detalleFilter}
                  />
                </th>
                <th className="px-3 py-2 font-medium border-b border-slate-200 text-right whitespace-nowrap">
                  Debe
                </th>
                <th className="px-3 py-2 font-medium border-b border-slate-200 text-right whitespace-nowrap">
                  Haber
                </th>
              </tr>
            </thead>
            <tbody>
              {data.movements.map((m) => (
                <tr
                  key={m._id}
                  className={clsx(
                    'border-t border-slate-100 hover:bg-slate-50/50',
                    m.anulacion && 'opacity-40',
                  )}
                >
                  <td className="px-3 py-1.5 font-mono text-slate-600 whitespace-nowrap">
                    {m.fechaISO.slice(0, 10)}
                  </td>
                  <td className="px-3 py-1.5 text-slate-500 tabular-nums">{m.asiento}</td>
                  <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                    <span className="font-mono text-slate-400 mr-1 text-[10px]">
                      {m.numeroCuentaReimputada}
                    </span>
                    {m.nombreCuentaReimputada}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">
                    {m.nombreSubcuenta ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 max-w-xs truncate">
                    {m.detalle || <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                    {m.debe ? fmt(m.debe, m.periodo) : ''}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                    {m.haber ? fmt(m.haber, m.periodo) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer: pagination + totals */}
      {data && (
        <footer className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs flex-shrink-0 gap-4">
          {/* Pagination */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-slate-600 tabular-nums select-none">
              Pág. {page + 1} / {totalPages || 1}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight size={14} />
            </button>
            <span className="text-slate-400 tabular-nums">
              {(page * PAGE_SIZE + 1).toLocaleString('es-AR')}–
              {Math.min((page + 1) * PAGE_SIZE, data.total).toLocaleString('es-AR')} de{' '}
              {data.total.toLocaleString('es-AR')}
            </span>
          </div>

          {/* Totals (always ARS — span multiple periods, no single rate) */}
          <div className="flex items-center gap-5 tabular-nums">
            {currency === 'USD' && (
              <span className="text-slate-400 text-[10px]">Totales en ARS</span>
            )}
            <span className="text-slate-600">
              Debe: <strong>{fmtMoney(data.totals.debe)}</strong>
            </span>
            <span className="text-slate-600">
              Haber: <strong>{fmtMoney(data.totals.haber)}</strong>
            </span>
            <span className={data.totals.saldo >= 0 ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
              Saldo (haber−debe): {fmtMoney(data.totals.saldo)}
            </span>
          </div>
        </footer>
      )}
    </div>
  );
}
