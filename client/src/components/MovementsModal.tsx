import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, Loader2, FileText } from 'lucide-react';
import { api } from '../lib/axios';
import { fmtMoney } from '../lib/format';

type Movement = {
  _id: string;
  empresa: string;
  periodo: string;
  fechaISO: string;
  archivo: string;
  sourceType: 'ledger' | 'cmv-calc';
  asiento: number;
  numeroCuenta: string;
  nombreCuenta: string;
  numeroSubcuenta: string | null;
  nombreSubcuenta: string | null;
  rubro: string;
  detalle: string;
  debe: number;
  haber: number;
  numeroCuentaReimputada: string;
  nombreCuentaReimputada: string;
  rubroReimputada: string;
  subrubro: string | null;
  anulacion: boolean;
};

type MovementsResponse = {
  periodo: string;
  empresa: string | null;
  total: number;
  offset: number;
  limit: number;
  count: number;
  /** Aggregated across ALL matching movs (independent of pagination/limit). */
  totals: {
    debe: number;
    haber: number;
    saldo: number; // haber - debe
  };
  movements: Movement[];
};

export type MovementsModalProps = {
  open: boolean;
  onClose: () => void;
  /** Filter title shown in the modal header */
  title: string;
  /** Subtitle (e.g. "Subrubro: Materia Prima") */
  subtitle?: string;
  /** Filters applied to /reports/movements */
  filters: {
    periodo: string;
    numeroCuentaReimputada?: string;
    subrubro?: string;
    rubroReimputada?: string;
    sourceType?: string;
    anulacion?: 'true' | 'false';
  };
};

/**
 * Modal showing the movimientos behind a given P&L line. Loads up to 500
 * movements (no pagination yet — the typical drill-down hits 1-200 movs).
 */
export function MovementsModal({ open, onClose, title, subtitle, filters }: MovementsModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const queryString = new URLSearchParams({
    periodo: filters.periodo,
    limit: '2000',
    ...(filters.numeroCuentaReimputada && {
      numeroCuentaReimputada: filters.numeroCuentaReimputada,
    }),
    ...(filters.subrubro && { subrubro: filters.subrubro }),
    ...(filters.rubroReimputada && { rubroReimputada: filters.rubroReimputada }),
    ...(filters.sourceType && { sourceType: filters.sourceType }),
    ...(filters.anulacion && { anulacion: filters.anulacion }),
  }).toString();

  const { data, isLoading, error } = useQuery({
    queryKey: ['movements', queryString],
    queryFn: async () =>
      (await api.get<MovementsResponse>(`/reports/movements?${queryString}`)).data,
    enabled: open,
    staleTime: 60_000,
  });

  if (!open) return null;

  // Use server-side aggregated totals (across ALL matching movs) so the
  // saldo always matches the P&L line, even when the visible page is
  // truncated by `limit`. Falls back to local sum only while loading.
  const totalDebe =
    data?.totals?.debe ?? data?.movements.reduce((s, m) => s + m.debe, 0) ?? 0;
  const totalHaber =
    data?.totals?.haber ?? data?.movements.reduce((s, m) => s + m.haber, 0) ?? 0;
  const saldo =
    data?.totals?.saldo ?? totalHaber - totalDebe;
  const truncated = data ? data.total > data.count : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-slate-100 text-slate-500"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="p-8 text-center text-slate-500 flex items-center justify-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Cargando movimientos…
            </div>
          )}
          {error && (
            <div className="p-8 text-center text-red-600 text-sm">
              Error al cargar movimientos
            </div>
          )}
          {data && data.movements.length === 0 && (
            <div className="p-8 text-center text-slate-500 text-sm">
              No hay movimientos para estos filtros.
            </div>
          )}
          {data && data.movements.length > 0 && (
            <table className="w-full text-xs">
              <thead className="bg-slate-50 sticky top-0">
                <tr className="text-left text-slate-600">
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Empresa</th>
                  <th className="px-3 py-2 font-medium">Asiento</th>
                  <th className="px-3 py-2 font-medium">Cuenta orig.</th>
                  <th className="px-3 py-2 font-medium">Subcuenta</th>
                  <th className="px-3 py-2 font-medium">Detalle</th>
                  <th className="px-3 py-2 font-medium text-right">Debe</th>
                  <th className="px-3 py-2 font-medium text-right">Haber</th>
                  <th className="px-3 py-2 font-medium text-center">Tags</th>
                </tr>
              </thead>
              <tbody>
                {data.movements.map((m) => (
                  <tr
                    key={m._id}
                    className="border-t border-slate-100 hover:bg-slate-50/50"
                  >
                    <td className="px-3 py-1.5 font-mono text-slate-700">
                      {m.fechaISO.slice(0, 10)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">{m.empresa}</td>
                    <td className="px-3 py-1.5 text-slate-500 tabular-nums">{m.asiento}</td>
                    <td className="px-3 py-1.5 text-slate-700">
                      <span className="font-mono text-slate-500">{m.numeroCuenta}</span>{' '}
                      {m.nombreCuenta}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600">
                      {m.nombreSubcuenta ?? '-'}
                    </td>
                    <td className="px-3 py-1.5 text-slate-600 max-w-[300px] truncate">
                      {m.detalle || '-'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                      {m.debe ? fmtMoney(m.debe) : ''}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">
                      {m.haber ? fmtMoney(m.haber) : ''}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {m.sourceType === 'cmv-calc' && (
                        <span className="inline-block px-1.5 py-0.5 text-[10px] bg-brand-100 text-brand-800 rounded">
                          CMV
                        </span>
                      )}
                      {m.anulacion && (
                        <span className="inline-block px-1.5 py-0.5 ml-1 text-[10px] bg-amber-100 text-amber-800 rounded">
                          ANUL
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer with totals */}
        {data && data.movements.length > 0 && (
          <footer className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-500">
              <FileText size={14} />
              {truncated ? (
                <>
                  <span>
                    Mostrando {data.count} de {data.total}
                  </span>
                  <span className="text-amber-700 font-medium">
                    (truncado — el saldo total contempla los {data.total} movs)
                  </span>
                </>
              ) : (
                <span>{data.total} movimiento{data.total !== 1 ? 's' : ''}</span>
              )}
            </div>
            <div className="flex items-center gap-6 tabular-nums">
              <span className="text-slate-600">
                Debe: <strong>{fmtMoney(totalDebe)}</strong>
              </span>
              <span className="text-slate-600">
                Haber: <strong>{fmtMoney(totalHaber)}</strong>
              </span>
              <span className={saldo >= 0 ? 'text-emerald-700' : 'text-red-700'}>
                Saldo (haber-debe): <strong>{fmtMoney(saldo)}</strong>
              </span>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
