import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react';
import { api } from '../lib/axios';
import { fmtMoney, fmtPeriodo } from '../lib/format';

type Cotizacion = {
  _id: string;
  periodo: string;
  fecha: string;
  compra: number;
  venta: number;
  promedio: number;
  fuente: 'sync' | 'manual';
};

type ListResponse = { count: number; cotizaciones: Cotizacion[] };

export function CotizacionesPage() {
  const qc = useQueryClient();
  const [editingPeriodo, setEditingPeriodo] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ fecha: '', compra: '', venta: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['cotizaciones'],
    queryFn: async () => (await api.get<ListResponse>('/cotizaciones')).data,
    staleTime: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: async () => (await api.post<{ upserted: number; skipped: number }>('/cotizaciones/sync')).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cotizaciones'] }),
  });

  const saveMutation = useMutation({
    mutationFn: async ({ periodo, body }: { periodo: string; body: { fecha: string; compra: number; venta: number } }) =>
      api.put(`/cotizaciones/${encodeURIComponent(periodo)}`, body),
    onSuccess: () => {
      setEditingPeriodo(null);
      qc.invalidateQueries({ queryKey: ['cotizaciones'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (periodo: string) =>
      api.delete(`/cotizaciones/${encodeURIComponent(periodo)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cotizaciones'] }),
  });

  const startEdit = (c: Cotizacion) => {
    setEditingPeriodo(c.periodo);
    setEditForm({ fecha: c.fecha, compra: String(c.compra), venta: String(c.venta) });
  };

  const saveEdit = () => {
    if (!editingPeriodo) return;
    saveMutation.mutate({
      periodo: editingPeriodo,
      body: {
        fecha: editForm.fecha,
        compra: parseFloat(editForm.compra),
        venta: parseFloat(editForm.venta),
      },
    });
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Cotizaciones dólar</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Tipo de cambio bolsa (promedio compra/venta) por período. Usado para la vista en USD.
          </p>
        </div>
        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-md text-sm hover:bg-brand-700 disabled:opacity-60"
        >
          {syncMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Sincronizar desde API
        </button>
      </div>

      {syncMutation.isSuccess && (
        <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-4 py-2">
          Sincronización exitosa: {syncMutation.data.upserted} actualizados,{' '}
          {syncMutation.data.skipped} manuales conservados.
        </div>
      )}
      {syncMutation.isError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-2">
          Error al sincronizar. Verificar conexión con argentinadatos.com.
        </div>
      )}

      {isLoading && (
        <div className="text-slate-500 flex items-center gap-2 text-sm">
          <Loader2 size={14} className="animate-spin" /> Cargando…
        </div>
      )}

      {data && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600 text-xs">
                <th className="px-4 py-2.5 font-medium">Período</th>
                <th className="px-4 py-2.5 font-medium">Fecha ref.</th>
                <th className="px-4 py-2.5 font-medium text-right">Compra</th>
                <th className="px-4 py-2.5 font-medium text-right">Venta</th>
                <th className="px-4 py-2.5 font-medium text-right">Promedio</th>
                <th className="px-4 py-2.5 font-medium text-center">Fuente</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {data.cotizaciones.map((c) =>
                editingPeriodo === c.periodo ? (
                  <tr key={c.periodo} className="border-t border-slate-100 bg-amber-50">
                    <td className="px-4 py-1.5 font-medium text-slate-700">
                      {fmtPeriodo(c.periodo)}
                    </td>
                    <td className="px-4 py-1.5">
                      <input
                        type="date"
                        value={editForm.fecha}
                        onChange={(e) => setEditForm((f) => ({ ...f, fecha: e.target.value }))}
                        className="border border-slate-300 rounded px-2 py-0.5 text-xs w-32"
                      />
                    </td>
                    <td className="px-4 py-1.5">
                      <input
                        type="number"
                        value={editForm.compra}
                        onChange={(e) => setEditForm((f) => ({ ...f, compra: e.target.value }))}
                        className="border border-slate-300 rounded px-2 py-0.5 text-xs w-24 text-right"
                      />
                    </td>
                    <td className="px-4 py-1.5">
                      <input
                        type="number"
                        value={editForm.venta}
                        onChange={(e) => setEditForm((f) => ({ ...f, venta: e.target.value }))}
                        className="border border-slate-300 rounded px-2 py-0.5 text-xs w-24 text-right"
                      />
                    </td>
                    <td className="px-4 py-1.5 text-right text-slate-500 text-xs tabular-nums">
                      {editForm.compra && editForm.venta
                        ? fmtMoney((parseFloat(editForm.compra) + parseFloat(editForm.venta)) / 2)
                        : '—'}
                    </td>
                    <td className="px-4 py-1.5 text-center">
                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
                        manual
                      </span>
                    </td>
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={saveEdit}
                          disabled={saveMutation.isPending}
                          className="p-1 rounded hover:bg-emerald-100 text-emerald-700"
                        >
                          <Check size={14} />
                        </button>
                        <button
                          onClick={() => setEditingPeriodo(null)}
                          className="p-1 rounded hover:bg-slate-100 text-slate-500"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.periodo} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {fmtPeriodo(c.periodo)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-slate-500">{c.fecha}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {fmtMoney(c.compra)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {fmtMoney(c.venta)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-slate-800">
                      {fmtMoney(c.promedio)}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${
                          c.fuente === 'manual'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {c.fuente}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => startEdit(c)}
                          className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Eliminar cotización de ${fmtPeriodo(c.periodo)}?`))
                              deleteMutation.mutate(c.periodo);
                          }}
                          className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
              {data.cotizaciones.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">
                    Sin cotizaciones. Usá "Sincronizar desde API" para cargar el histórico.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
