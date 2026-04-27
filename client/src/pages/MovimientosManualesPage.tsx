import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, AlertTriangle, Search, Info } from 'lucide-react';
import { api } from '../lib/axios';
import { fmtMoney, fmtPeriodo } from '../lib/format';
import { PeriodSelector } from '../components/PeriodSelector';

const EMPRESAS = ['SUPERBOL', 'PRUEBAS', 'SUSTEN', 'POINT'] as const;
type Empresa = (typeof EMPRESAS)[number];

type ManualMovement = {
  _id: string;
  empresa: Empresa;
  periodo: string;
  fechaISO: string;
  numeroCuenta: string;
  nombreCuenta: string;
  numeroSubcuenta: string | null;
  nombreSubcuenta: string | null;
  rubro: string;
  subrubro: string | null;
  detalle: string;
  debe: number;
  haber: number;
};

type ManualListResponse = { count: number; movements: ManualMovement[] };

type CuentaCatalog = {
  numeroCuenta: string;
  nombreCuenta: string;
  rubro: string;
  count: number;
};
type CuentasResponse = { count: number; items: CuentaCatalog[] };

type FormState = {
  empresa: Empresa;
  fechaISO: string; // YYYY-MM-DD
  numeroCuenta: string;
  nombreCuenta: string;
  numeroSubcuenta: string;
  nombreSubcuenta: string;
  detalle: string;
  tipo: 'debe' | 'haber';
  monto: string; // string for input; parsed to number on submit
};

const blankForm = (periodo: string | null): FormState => ({
  empresa: 'SUPERBOL',
  fechaISO: lastDayOfPeriod(periodo) ?? '',
  numeroCuenta: '',
  nombreCuenta: '',
  numeroSubcuenta: '',
  nombreSubcuenta: '',
  detalle: '',
  tipo: 'debe',
  monto: '',
});

/** Returns YYYY-MM-DD for the last day of the MM/YYYY period (UTC). */
function lastDayOfPeriod(periodo: string | null): string | null {
  if (!periodo) return null;
  const m = /^(\d{2})\/(\d{4})$/.exec(periodo);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const yyyy = parseInt(m[2], 10);
  const lastDay = new Date(Date.UTC(yyyy, mm, 0)).getUTCDate();
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

export function MovimientosManualesPage() {
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => blankForm(null));
  const [submitWarnings, setSubmitWarnings] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // When the global periodo changes, sync the form's fecha to it.
  useEffect(() => {
    if (periodo) {
      setForm((f) => ({ ...f, fechaISO: lastDayOfPeriod(periodo) ?? f.fechaISO }));
    }
  }, [periodo]);

  // Catalog of accounts for the autocomplete
  const cuentasQuery = useQuery({
    queryKey: ['cuentas-catalog'],
    queryFn: async () => (await api.get<CuentasResponse>('/movimientos/cuentas')).data,
    staleTime: 5 * 60_000,
  });

  // List of manual movements for the selected period
  const listQuery = useQuery({
    queryKey: ['manual-movements', periodo],
    queryFn: async () =>
      (await api.get<ManualListResponse>(`/movimientos/manual?periodo=${periodo}`)).data,
    enabled: !!periodo,
    staleTime: 0,
  });

  const createMut = useMutation({
    mutationFn: async (input: FormState) => {
      if (!periodo) throw new Error('Sin período');
      const payload = {
        empresa: input.empresa,
        periodo,
        fechaISO: input.fechaISO,
        numeroCuenta: input.numeroCuenta.trim(),
        nombreCuenta: input.nombreCuenta.trim(),
        numeroSubcuenta: input.numeroSubcuenta.trim() || null,
        nombreSubcuenta: input.nombreSubcuenta.trim() || null,
        detalle: input.detalle.trim(),
        debe: input.tipo === 'debe' ? Number(input.monto) : 0,
        haber: input.tipo === 'haber' ? Number(input.monto) : 0,
      };
      const res = await api.post<{ movement: ManualMovement; warnings: string[] }>(
        '/movimientos/manual',
        payload,
      );
      return res.data;
    },
    onSuccess: (data) => {
      setSubmitWarnings(data.warnings);
      setSubmitError(null);
      setForm(blankForm(periodo));
      qc.invalidateQueries({ queryKey: ['manual-movements'] });
      qc.invalidateQueries({ queryKey: ['evolucion'] });
      qc.invalidateQueries({ queryKey: ['pnl'] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string } } };
      setSubmitError(e.response?.data?.error ?? (err instanceof Error ? err.message : 'Error'));
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/movimientos/manual/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manual-movements'] });
      qc.invalidateQueries({ queryKey: ['evolucion'] });
      qc.invalidateQueries({ queryKey: ['pnl'] });
    },
  });

  const isCuentaNew = useMemo(() => {
    if (!form.numeroCuenta.trim() || !cuentasQuery.data) return false;
    const exists = cuentasQuery.data.items.some(
      (c) =>
        c.numeroCuenta === form.numeroCuenta.trim() &&
        c.nombreCuenta.trim().toLowerCase() === form.nombreCuenta.trim().toLowerCase(),
    );
    return !exists && form.nombreCuenta.trim().length > 0;
  }, [form.numeroCuenta, form.nombreCuenta, cuentasQuery.data]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!periodo) return;
    if (!form.monto || Number(form.monto) <= 0) {
      setSubmitError('El monto debe ser mayor a 0');
      return;
    }
    setSubmitError(null);
    createMut.mutate(form);
  };

  return (
    <div className="ds-fade-in" style={{ padding: '28px 36px 80px', maxWidth: 1280, margin: '0 auto' }}>
      <header className="ds-page-header">
        <div>
          <h1 className="ds-page-title">Movimientos manuales</h1>
          <p className="ds-page-subtitle">
            Asientos que no están en el mayor — IIBB, sueldos, honorarios directores, etc.
            Sobreviven a re-ingestas del período.
          </p>
        </div>
        <PeriodSelector value={periodo} onChange={setPeriodo} />
      </header>

      {!periodo && (
        <div className="bg-white rounded-lg border border-slate-200 p-12 text-center text-slate-500">
          Elegí un período para cargar movimientos manuales.
        </div>
      )}

      {periodo && (
        <>
          {/* Form */}
          <section className="bg-white rounded-lg border border-slate-200 p-5 mb-6">
            <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Plus size={14} /> Nuevo movimiento — {fmtPeriodo(periodo)}
            </h3>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
                <Field label="Empresa">
                  <select
                    value={form.empresa}
                    onChange={(e) =>
                      setForm({ ...form, empresa: e.target.value as Empresa })
                    }
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm bg-white"
                  >
                    {EMPRESAS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Fecha">
                  <input
                    type="date"
                    value={form.fechaISO}
                    onChange={(e) => setForm({ ...form, fechaISO: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm"
                    required
                  />
                </Field>
                <Field label="Tipo">
                  <div className="flex gap-3 text-sm pt-1">
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="tipo"
                        checked={form.tipo === 'debe'}
                        onChange={() => setForm({ ...form, tipo: 'debe' })}
                      />
                      Debe
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="tipo"
                        checked={form.tipo === 'haber'}
                        onChange={() => setForm({ ...form, tipo: 'haber' })}
                      />
                      Haber
                    </label>
                  </div>
                </Field>
                <Field label="Monto">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.monto}
                    onChange={(e) => setForm({ ...form, monto: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm tabular-nums"
                    placeholder="0.00"
                    required
                  />
                </Field>
              </div>

              {/* Cuenta autocomplete */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
                <Field label="Cuenta (autocomplete)">
                  <CuentaAutocomplete
                    catalog={cuentasQuery.data?.items ?? []}
                    numero={form.numeroCuenta}
                    nombre={form.nombreCuenta}
                    onPick={(c) =>
                      setForm({
                        ...form,
                        numeroCuenta: c.numeroCuenta,
                        nombreCuenta: c.nombreCuenta,
                      })
                    }
                  />
                </Field>
                <Field label="Número de cuenta *">
                  <input
                    type="text"
                    value={form.numeroCuenta}
                    onChange={(e) => setForm({ ...form, numeroCuenta: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm font-mono"
                    placeholder="ej. 6770"
                    required
                  />
                </Field>
                <Field label="Nombre de cuenta *">
                  <input
                    type="text"
                    value={form.nombreCuenta}
                    onChange={(e) => setForm({ ...form, nombreCuenta: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm"
                    placeholder="ej. Ingresos Brutos"
                    required
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
                <Field label="Subcuenta (número, opc.)">
                  <input
                    type="text"
                    value={form.numeroSubcuenta}
                    onChange={(e) => setForm({ ...form, numeroSubcuenta: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm font-mono"
                  />
                </Field>
                <Field label="Subcuenta (nombre, opc.)">
                  <input
                    type="text"
                    value={form.nombreSubcuenta}
                    onChange={(e) => setForm({ ...form, nombreSubcuenta: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm"
                  />
                </Field>
                <Field label="Detalle (opcional)">
                  <input
                    type="text"
                    value={form.detalle}
                    onChange={(e) => setForm({ ...form, detalle: e.target.value })}
                    className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-sm"
                  />
                </Field>
              </div>

              {isCuentaNew && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mb-3 flex gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Esta cuenta no aparece en el catálogo (no se vio en mayores cargados). Se va a crear
                    igualmente — revisá número y nombre antes de confirmar.
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-brand-600 text-white hover:bg-brand-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {createMut.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Plus size={14} />
                  )}
                  Agregar movimiento
                </button>
                {submitError && (
                  <span className="text-sm text-red-700">{submitError}</span>
                )}
              </div>

              {submitWarnings.length > 0 && (
                <ul className="mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-1">
                  {submitWarnings.map((w, i) => (
                    <li key={i} className="flex gap-2">
                      <Info size={12} className="mt-0.5 shrink-0" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </form>
          </section>

          {/* List */}
          <section className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <header className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">
                Cargados en {fmtPeriodo(periodo)} ({listQuery.data?.count ?? 0})
              </h3>
            </header>

            {listQuery.isLoading && (
              <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Cargando…
              </div>
            )}

            {listQuery.data && listQuery.data.movements.length === 0 && (
              <div className="p-8 text-center text-slate-500 text-sm">
                Aún no hay movimientos manuales para este período.
              </div>
            )}

            {listQuery.data && listQuery.data.movements.length > 0 && (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-slate-600 text-left">
                    <th className="px-3 py-2 font-medium">Fecha</th>
                    <th className="px-3 py-2 font-medium">Empresa</th>
                    <th className="px-3 py-2 font-medium">Cuenta</th>
                    <th className="px-3 py-2 font-medium">Subrubro</th>
                    <th className="px-3 py-2 font-medium">Detalle</th>
                    <th className="px-3 py-2 font-medium text-right">Debe</th>
                    <th className="px-3 py-2 font-medium text-right">Haber</th>
                    <th className="px-3 py-2 font-medium w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {listQuery.data.movements.map((m) => (
                    <tr
                      key={m._id}
                      className="border-t border-slate-100 hover:bg-slate-50/50"
                    >
                      <td className="px-3 py-1.5 font-mono text-slate-700">
                        {m.fechaISO.slice(0, 10)}
                      </td>
                      <td className="px-3 py-1.5 text-slate-700">{m.empresa}</td>
                      <td className="px-3 py-1.5 text-slate-700">
                        <span className="font-mono text-slate-500">{m.numeroCuenta}</span>{' '}
                        {m.nombreCuenta}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">
                        {m.subrubro ?? <span className="text-amber-700 italic">(sin asignar)</span>}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600 max-w-xs truncate">
                        {m.detalle || '-'}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {m.debe ? fmtMoney(m.debe) : ''}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {m.haber ? fmtMoney(m.haber) : ''}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Borrar el movimiento de ${m.nombreCuenta} por $${fmtMoney(m.debe || m.haber)}?`)) {
                              deleteMut.mutate(m._id);
                            }
                          }}
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title="Borrar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right text-slate-600 font-medium">
                      Totales:
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">
                      {fmtMoney(
                        listQuery.data.movements.reduce((s, m) => s + m.debe, 0),
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">
                      {fmtMoney(
                        listQuery.data.movements.reduce((s, m) => s + m.haber, 0),
                      )}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

/**
 * Filterable dropdown that picks (numeroCuenta + nombreCuenta) from the
 * catalog. Free-form search by either field. On select, populates both
 * fields in the parent form.
 */
function CuentaAutocomplete({
  catalog,
  numero,
  nombre,
  onPick,
}: {
  catalog: CuentaCatalog[];
  numero: string;
  nombre: string;
  onPick: (c: CuentaCatalog) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog.slice(0, 20);
    return catalog
      .filter(
        (c) =>
          c.numeroCuenta.toLowerCase().includes(q) ||
          c.nombreCuenta.toLowerCase().includes(q),
      )
      .slice(0, 20);
  }, [query, catalog]);

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            numero && nombre ? `${numero} ${nombre}` : 'Buscar por número o nombre…'
          }
          className="w-full pl-7 pr-2 py-1.5 border border-slate-300 rounded-md text-sm"
        />
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-72 overflow-auto">
          {filtered.map((c) => (
            <li key={`${c.numeroCuenta}-${c.nombreCuenta}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(c);
                  setQuery('');
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between gap-2 text-xs"
              >
                <span>
                  <span className="font-mono text-slate-500">{c.numeroCuenta}</span>{' '}
                  <span className="text-slate-800">{c.nombreCuenta}</span>
                </span>
                <span className="text-slate-400">{c.rubro}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
