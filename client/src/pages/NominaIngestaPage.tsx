import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Trash2,
  X,
  Users,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/axios';
import { fmtMoney, fmtPeriodo } from '../lib/format';

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckResponse = {
  periodo: string;
  loaded: boolean;
  batch: {
    _id: string;
    periodo: string;
    file: { name: string };
    stats: { recordCount: number; totalCost: number; pseudoMovementsInserted: number };
    createdAt: string;
  } | null;
};

type IngestResult = {
  periodo: string;
  batchId: string;
  recordCount: number;
  totalCost: number;
  pseudoMovementsInserted: number;
  warnings: string[];
};

type PayrollBatch = {
  _id: string;
  periodo: string;
  file: { name: string };
  stats: { recordCount: number; totalCost: number; pseudoMovementsInserted: number };
  createdAt: string;
};

type Stage =
  | { type: 'idle' }
  | { type: 'confirm'; file: File; periodo: string }
  | { type: 'done'; result: IngestResult };

const PERIODO_RE = /^\d{2}\/\d{4}$/;

/** Detect MM/YYYY from filenames like "COSTO NOMINA POR SECTOR 02-2026.xlsx" */
const detectPeriodo = (filename: string): string => {
  const m = filename.match(/(\d{2})[-_](\d{4})/);
  if (!m) return '';
  return `${m[1]}/${m[2]}`;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// ── NominaIngestaPage ─────────────────────────────────────────────────────────

export function NominaIngestaPage() {
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>({ type: 'idle' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStage({ type: 'idle' });
    setErrorMessage(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      setErrorMessage('Solo se aceptan archivos .xlsx o .xls');
      return;
    }
    setErrorMessage(null);
    setStage({ type: 'confirm', file, periodo: detectPeriodo(file.name) });
  }, []);

  // ── Check existing batch ───────────────────────────────────────────────────
  const confirmPeriodo = stage.type === 'confirm' ? stage.periodo : '';
  const checkQuery = useQuery({
    queryKey: ['nomina-check', confirmPeriodo],
    queryFn: async () =>
      (await api.get<CheckResponse>(`/nomina/check?periodo=${confirmPeriodo}`)).data,
    enabled: stage.type === 'confirm' && PERIODO_RE.test(confirmPeriodo),
    staleTime: 5_000,
  });

  // ── Ingest mutation ────────────────────────────────────────────────────────
  const ingestMutation = useMutation({
    mutationFn: async ({ force }: { force: boolean }) => {
      if (stage.type !== 'confirm') throw new Error('Estado inválido');
      const fd = new FormData();
      fd.append('nomina', stage.file);
      fd.append('periodo', stage.periodo);
      const url = force ? '/nomina?force=true' : '/nomina';
      return (
        await api.post<IngestResult>(url, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
          timeout: 3 * 60_000,
        })
      ).data;
    },
    onSuccess: (data) => {
      setStage({ type: 'done', result: data });
      setErrorMessage(null);
      qc.invalidateQueries({ queryKey: ['nomina-batches'] });
      qc.invalidateQueries({ queryKey: ['nomina-check'] });
      qc.invalidateQueries({ queryKey: ['periodos'] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      setErrorMessage(e.response?.data?.error ?? (err instanceof Error ? err.message : String(err)));
    },
  });

  const periodoValid = stage.type === 'confirm' && PERIODO_RE.test(stage.periodo);
  const hasConflict = checkQuery.data?.loaded === true;
  const canSubmit = periodoValid && !ingestMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="ds-fade-in" style={{ padding: '28px 36px 80px', maxWidth: 860, margin: '0 auto' }}>
      <header className="ds-page-header">
        <div>
          <h1 className="ds-page-title">Ingesta de nómina</h1>
          <p className="ds-page-subtitle">
            Cargá el Excel de costo de nómina por sector. El período se detecta del nombre del archivo.
          </p>
        </div>
      </header>

      {errorMessage && (
        <div className="bg-red-50 border border-red-300 rounded-md p-4 mb-6 flex gap-2 text-red-800 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>Error:</strong> {errorMessage}
          </div>
        </div>
      )}

      {/* Drop zone */}
      {stage.type === 'idle' && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          className="text-center cursor-pointer transition-all"
          style={{
            border: '1.5px dashed',
            borderColor: isDragging ? 'var(--gain)' : 'var(--border)',
            background: isDragging ? 'oklch(0.78 0.18 152 / 0.04)' : 'var(--bg-surface)',
            borderRadius: 'var(--r-lg)',
            padding: '52px 32px 40px',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xls,.xlsx"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <div className="flex flex-col items-center gap-3">
            <div
              className="grid place-items-center"
              style={{
                width: 56, height: 56,
                borderRadius: 'var(--r-lg)',
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--fg-secondary)',
              }}
            >
              <Users size={24} />
            </div>
            <div>
              <p className="text-base font-medium" style={{ color: 'var(--fg-primary)' }}>
                Arrastrá o hacé click para seleccionar
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--fg-tertiary)' }}>
                Planilla de costo nómina por sector — formato multi-pestaña
              </p>
              <p className="text-[11px] mt-2" style={{ color: 'var(--fg-quaternary)' }}>
                .xlsx
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Confirm stage */}
      {stage.type === 'confirm' && (
        <div className="space-y-4">
          {/* File + period card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet size={20} className="text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{stage.file.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {(stage.file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                onClick={reset}
                className="text-slate-400 hover:text-slate-600 shrink-0"
                title="Cambiar archivo"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex items-end gap-4 flex-wrap pt-1 border-t border-slate-100">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Período
                </label>
                <input
                  type="text"
                  value={stage.periodo}
                  onChange={(e) =>
                    setStage((s) => s.type === 'confirm' ? { ...s, periodo: e.target.value } : s)
                  }
                  placeholder="MM/YYYY"
                  className={clsx(
                    'px-3 py-1.5 border rounded-md text-sm w-28 font-mono',
                    periodoValid ? 'border-slate-300' : 'border-red-400 bg-red-50',
                  )}
                />
                {!periodoValid && (
                  <p className="text-xs text-red-600 mt-1">Formato inválido — usá MM/YYYY</p>
                )}
              </div>
            </div>
          </div>

          {/* Conflict / clear indicator */}
          {periodoValid && (
            <div>
              {checkQuery.isLoading && (
                <div className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Loader2 size={12} className="animate-spin" /> Verificando período…
                </div>
              )}
              {!checkQuery.isLoading && checkQuery.data && !hasConflict && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                  <CheckCircle2 size={15} />
                  Período libre — no hay nómina cargada para {fmtPeriodo(stage.periodo)}.
                </div>
              )}
              {!checkQuery.isLoading && hasConflict && checkQuery.data?.batch && (
                <div className="bg-amber-50 border border-amber-300 rounded-md px-4 py-3 text-sm">
                  <div className="flex items-start gap-2 text-amber-900">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                    <div>
                      <strong>Ya existe nómina para {fmtPeriodo(stage.periodo)}</strong>
                      <p className="text-xs text-amber-800 mt-1">
                        Cargada el {fmtDate(checkQuery.data.batch.createdAt)} ·{' '}
                        {checkQuery.data.batch.stats.recordCount} empleados ·{' '}
                        $ {fmtMoney(checkQuery.data.batch.stats.totalCost)}
                      </p>
                      <p className="text-xs text-amber-700 mt-1">
                        Al procesar con "Reemplazar" se elimina la carga anterior.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            {!hasConflict && (
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => ingestMutation.mutate({ force: false })}
                className={clsx(
                  'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                  canSubmit
                    ? 'bg-brand-600 text-white hover:bg-brand-700'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed',
                )}
              >
                {ingestMutation.isPending
                  ? <Loader2 size={15} className="animate-spin" />
                  : <Upload size={15} />}
                Procesar
              </button>
            )}

            {hasConflict && (
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => {
                  if (
                    window.confirm(
                      `Esto va a reemplazar la nómina de ${fmtPeriodo(stage.periodo)}. ¿Confirmás?`,
                    )
                  ) {
                    ingestMutation.mutate({ force: true });
                  }
                }}
                className={clsx(
                  'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
                  canSubmit
                    ? 'bg-amber-600 text-white hover:bg-amber-700'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed',
                )}
              >
                {ingestMutation.isPending
                  ? <Loader2 size={15} className="animate-spin" />
                  : <Trash2 size={15} />}
                Reemplazar
              </button>
            )}

            <button
              type="button"
              onClick={reset}
              disabled={ingestMutation.isPending}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >
              <X size={14} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Done stage */}
      {stage.type === 'done' && (
        <>
          <ResultPanel result={stage.result} />
          <button
            onClick={reset}
            className="mt-4 inline-flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
          >
            <RotateCcw size={14} /> Nueva carga
          </button>
        </>
      )}

      {/* Batch history */}
      {(stage.type === 'idle' || stage.type === 'done') && (
        <PayrollBatchList className="mt-8" />
      )}
    </div>
  );
}

// ── ResultPanel ───────────────────────────────────────────────────────────────

function ResultPanel({ result }: { result: IngestResult }) {
  return (
    <section className="bg-white rounded-lg border border-emerald-200 p-6">
      <div className="flex items-start gap-3 mb-5">
        <CheckCircle2 size={24} className="text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Nómina cargada — {fmtPeriodo(result.periodo)}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {result.recordCount} empleados · {result.pseudoMovementsInserted} movimientos generados en P&L
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-md px-3 py-2 bg-slate-50">
          <dt className="text-xs text-slate-500">Empleados</dt>
          <dd className="font-semibold text-slate-900 tabular-nums">{result.recordCount}</dd>
        </div>
        <div className="rounded-md px-3 py-2 bg-slate-50">
          <dt className="text-xs text-slate-500">Movimientos P&L</dt>
          <dd className="font-semibold text-slate-900 tabular-nums">
            {result.pseudoMovementsInserted}
          </dd>
        </div>
        <div className="rounded-md px-3 py-2 bg-brand-50 border border-brand-200">
          <dt className="text-xs text-slate-500">Costo total</dt>
          <dd className="font-semibold text-brand-800 tabular-nums">
            $ {fmtMoney(result.totalCost)}
          </dd>
        </div>
      </dl>

      {result.warnings.length > 0 && (
        <div className="border-t border-slate-200 mt-5 pt-4">
          <div className="flex items-center gap-2 mb-2 text-amber-800">
            <AlertTriangle size={14} />
            <h4 className="text-sm font-medium">
              {result.warnings.length} advertencia{result.warnings.length !== 1 ? 's' : ''}
            </h4>
          </div>
          <ul className="text-xs text-slate-600 space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// ── PayrollBatchList ──────────────────────────────────────────────────────────

function PayrollBatchList({ className }: { className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['nomina-batches'],
    queryFn: async () =>
      (await api.get<{ count: number; batches: PayrollBatch[] }>('/nomina')).data,
    staleTime: 10_000,
  });

  if (isLoading) return null;
  const batches = data?.batches ?? [];
  if (!batches.length) return null;

  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Nóminas cargadas</h3>
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-left text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-2.5">Período</th>
              <th className="px-4 py-2.5">Archivo</th>
              <th className="px-4 py-2.5 text-right">Empleados</th>
              <th className="px-4 py-2.5 text-right">Costo total</th>
              <th className="px-4 py-2.5 text-right">Cargado</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b._id} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                  {fmtPeriodo(b.periodo)}
                </td>
                <td className="px-4 py-2.5 text-slate-500 truncate max-w-xs" title={b.file.name}>
                  {b.file.name}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                  {b.stats.recordCount}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700 font-medium">
                  $ {fmtMoney(b.stats.totalCost)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-400">
                  {fmtDate(b.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
