import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  X,
  FileSpreadsheet,
  Loader2,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/axios';
import { fmtPeriodo } from '../lib/format';

// ── Types ─────────────────────────────────────────────────────────────────

const EMPRESAS = ['SUPERBOL', 'PRUEBAS', 'SUSTEN', 'POINT'] as const;
type Empresa = (typeof EMPRESAS)[number];

type SniffResult = {
  filename: string;
  type: 'inventory' | 'ledger' | 'unknown';
  empresa: Empresa | null;
  periodo: string | null;
  size: number;
  error?: string;
};

type CheckResponse =
  | { exists: false; periodo: string }
  | {
      exists: true;
      periodo: string;
      batchId: string;
      createdAt: string;
      files: { name: string; kind: 'ledger' | 'inventory'; empresa: Empresa | null; rowsProcessed: number }[];
      stats: {
        movementsInserted: number;
        inventoryItems: number;
        cmvAjustado: number;
      };
    };

type IngestaResult = {
  batchId: string;
  periodo: string;
  status: 'success' | 'failed';
  stats: {
    movementsInserted: number;
    inventoryItems: number;
    stockInicial: number;
    compras: number;
    stockFinal: number;
    cmvBruto: number;
    costoFinanciero: number;
    cmvAjustado: number;
  };
  files: { name: string; kind: 'ledger' | 'inventory'; empresa: Empresa | null; rowsProcessed: number }[];
  warnings: {
    parser: { code: string; message: string; rowNumber?: number }[];
    enrichment: { code: string; message: string; occurrences: number }[];
    inventory: { code: string; message: string }[];
    cmv: { code: string; message: string }[];
  };
};

// State machine stages
type Stage =
  | { type: 'idle' }
  | { type: 'sniffing' }
  | {
      type: 'confirm';
      droppedFiles: File[];
      sniffed: SniffResult[];
      // User-editable per-file empresa (index → empresa)
      empresas: (Empresa | null)[];
      // Detected period (user-editable)
      periodo: string;
    }
  | { type: 'done'; result: IngestaResult };

const PERIODO_RE = /^\d{2}\/\d{4}$/;

const fmtBytes = (n: number) =>
  n > 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} MB`
    : `${(n / 1024).toFixed(0)} KB`;

const fmtMoney = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── IngestaPage ─────────────────────────────────────────────────────────────

export function IngestaPage() {
  const qc = useQueryClient();
  const [stage, setStage] = useState<Stage>({ type: 'idle' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ── Sniff mutation ─────────────────────────────────────────────────────
  const sniffMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      return (await api.post<{ results: SniffResult[] }>('/ingesta/sniff', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })).data.results;
    },
    onSuccess: (results, files) => {
      // Auto-fill periodo from majority vote of detected periods
      const periodos = results
        .filter((r) => r.periodo !== null)
        .map((r) => r.periodo as string);
      const freq = periodos.reduce<Record<string, number>>((acc, p) => {
        acc[p] = (acc[p] ?? 0) + 1;
        return acc;
      }, {});
      const detected = Object.entries(freq).sort(([, a], [, b]) => b - a)[0]?.[0] ?? '';

      setStage({
        type: 'confirm',
        droppedFiles: files,
        sniffed: results,
        empresas: results.map((r) => r.empresa),
        periodo: detected,
      });
      setErrorMessage(null);
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string } } };
      setErrorMessage(e.response?.data?.error ?? 'Error al analizar los archivos');
      setStage({ type: 'idle' });
    },
  });

  // ── Ingesta mutation ───────────────────────────────────────────────────
  const ingestaMutation = useMutation({
    mutationFn: async ({ force }: { force: boolean }) => {
      if (stage.type !== 'confirm') throw new Error('Estado inválido');
      const fd = new FormData();
      for (let i = 0; i < stage.droppedFiles.length; i++) {
        const sniff = stage.sniffed[i];
        const file = stage.droppedFiles[i];
        if (sniff.type === 'inventory') {
          fd.append('inventory', file);
        } else if (sniff.type === 'ledger') {
          const emp = stage.empresas[i];
          if (emp) fd.append(`ledger_${emp}`, file);
        }
        // 'unknown' files are skipped
      }
      const url = force ? '/ingesta?force=true' : '/ingesta';
      return (await api.post<IngestaResult>(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 5 * 60_000,
      })).data;
    },
    onSuccess: (data) => {
      setStage({ type: 'done', result: data });
      setErrorMessage(null);
      qc.invalidateQueries({ queryKey: ['ingesta-check'] });
      qc.invalidateQueries({ queryKey: ['periodos'] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      const msg = e.response?.data?.error ?? (err instanceof Error ? err.message : String(err));
      setErrorMessage(msg);
    },
  });

  // ── Pre-check for existing batch (only in confirm stage) ───────────────
  const confirmPeriodo = stage.type === 'confirm' ? stage.periodo : '';
  const checkQuery = useQuery({
    queryKey: ['ingesta-check', confirmPeriodo],
    queryFn: async () =>
      (await api.get<CheckResponse>(`/ingesta/check?periodo=${confirmPeriodo}`)).data,
    enabled: stage.type === 'confirm' && PERIODO_RE.test(confirmPeriodo),
    staleTime: 5_000,
  });
  const existingBatch =
    checkQuery.data && checkQuery.data.exists ? checkQuery.data : null;

  // ── File drop handling ─────────────────────────────────────────────────
  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const arr = Array.from(files).filter(
        (f) => f.name.endsWith('.xls') || f.name.endsWith('.xlsx'),
      );
      if (!arr.length) {
        setErrorMessage('Solo se aceptan archivos .xls y .xlsx');
        return;
      }
      setErrorMessage(null);
      setStage({ type: 'sniffing' });
      sniffMutation.mutate(arr);
    },
    [sniffMutation],
  );

  const reset = useCallback(() => {
    setStage({ type: 'idle' });
    setErrorMessage(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold text-slate-900">Ingesta mensual</h2>
        <p className="text-sm text-slate-500 mt-1">
          Arrastrá uno o varios archivos. El sistema detecta el tipo y período de cada uno.
        </p>
      </header>

      {/* Error banner */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-300 rounded-md p-4 mb-6 flex gap-2 text-red-800 text-sm">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <div>
            <strong>Error:</strong> {errorMessage}
          </div>
        </div>
      )}

      {/* ── Stage: idle or sniffing ────────────────────────────────────── */}
      {(stage.type === 'idle' || stage.type === 'sniffing') && (
        <div
          ref={dropRef}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            handleFiles(e.dataTransfer.files);
          }}
          className={clsx(
            'border-2 border-dashed rounded-xl p-14 text-center cursor-pointer transition-colors',
            isDragging
              ? 'border-brand-500 bg-brand-50'
              : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xls,.xlsx"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          {stage.type === 'sniffing' ? (
            <div className="flex flex-col items-center gap-3 text-slate-500">
              <Loader2 size={32} className="animate-spin text-brand-500" />
              <p className="text-sm font-medium">Analizando archivos…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-slate-400">
              <Upload size={32} />
              <div>
                <p className="text-sm font-medium text-slate-600">
                  Arrastrá o hacé click para seleccionar
                </p>
                <p className="text-xs mt-1">
                  Mayor por empresa (uno o más) · Inventario consolidado
                </p>
                <p className="text-xs text-slate-300 mt-0.5">.xls / .xlsx</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Stage: confirm ─────────────────────────────────────────────── */}
      {stage.type === 'confirm' && (
        <ConfirmStage
          stage={stage}
          existingBatch={existingBatch}
          checkLoading={checkQuery.isLoading}
          ingesting={ingestaMutation.isPending}
          onPeriodoChange={(p) =>
            setStage((s) => s.type === 'confirm' ? { ...s, periodo: p } : s)
          }
          onEmpresaChange={(idx, emp) =>
            setStage((s) => {
              if (s.type !== 'confirm') return s;
              const next = [...s.empresas];
              next[idx] = emp;
              return { ...s, empresas: next };
            })
          }
          onSubmit={(force) => ingestaMutation.mutate({ force })}
          onReset={reset}
          onAddMore={() => inputRef.current?.click()}
        />
      )}
      {/* Hidden input for "add more" in confirm stage */}
      {stage.type === 'confirm' && (
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      )}

      {/* ── Stage: done ────────────────────────────────────────────────── */}
      {stage.type === 'done' && (
        <>
          <ResultPanel result={stage.result} />
          <button
            onClick={reset}
            className="mt-4 inline-flex items-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-md"
          >
            <RotateCcw size={14} /> Nueva ingesta
          </button>
        </>
      )}

      {/* ── Loaded periods list (always visible) ───────────────────────── */}
      {(stage.type === 'idle' || stage.type === 'done') && (
        <BatchList className="mt-8" />
      )}
    </div>
  );
}

// ── ConfirmStage ────────────────────────────────────────────────────────────

type ExistingBatch = Extract<CheckResponse, { exists: true }>;

function ConfirmStage({
  stage,
  existingBatch,
  checkLoading,
  ingesting,
  onPeriodoChange,
  onEmpresaChange,
  onSubmit,
  onReset,
}: {
  stage: Extract<Stage, { type: 'confirm' }>;
  existingBatch: ExistingBatch | null;
  checkLoading: boolean;
  ingesting: boolean;
  onPeriodoChange: (p: string) => void;
  onEmpresaChange: (idx: number, e: Empresa | null) => void;
  onSubmit: (force: boolean) => void;
  onReset: () => void;
  onAddMore: () => void;
}) {
  const { sniffed, empresas, periodo } = stage;
  const periodoValid = PERIODO_RE.test(periodo);

  // Validate: every ledger file must have an empresa assigned
  const ledgersMissingEmpresa = sniffed.some(
    (s, i) => s.type === 'ledger' && !empresas[i],
  );
  const hasLedger = sniffed.some((s) => s.type === 'ledger');
  const canSubmit = periodoValid && hasLedger && !ledgersMissingEmpresa && !ingesting;

  // Detect empresa conflicts (two ledger files assigned same empresa)
  const empCounts: Partial<Record<Empresa, number>> = {};
  sniffed.forEach((s, i) => {
    if (s.type === 'ledger' && empresas[i]) {
      const e = empresas[i]!;
      empCounts[e] = (empCounts[e] ?? 0) + 1;
    }
  });
  const duplicateEmpresa = Object.values(empCounts).some((c) => (c ?? 0) > 1);

  // Period mismatch: ledger files have different detected periods
  const detectedPeriods = new Set(
    sniffed
      .filter((s) => s.type === 'ledger' && s.periodo)
      .map((s) => s.periodo),
  );
  const periodMismatch = detectedPeriods.size > 1;

  const typeLabel = (s: SniffResult) => {
    if (s.type === 'inventory') return 'Inventario';
    if (s.type === 'ledger') return 'Mayor';
    return 'Desconocido';
  };

  const typeColor = (s: SniffResult) => {
    if (s.type === 'inventory') return 'text-violet-700 bg-violet-50';
    if (s.type === 'ledger') return 'text-brand-700 bg-brand-50';
    return 'text-slate-500 bg-slate-100';
  };

  return (
    <div className="space-y-5">
      {/* Period + file count header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Período
            </label>
            <input
              type="text"
              value={periodo}
              onChange={(e) => onPeriodoChange(e.target.value)}
              placeholder="MM/YYYY"
              className={clsx(
                'px-3 py-1.5 border rounded-md text-sm w-28 font-mono',
                periodoValid ? 'border-slate-300' : 'border-red-400 bg-red-50',
              )}
            />
          </div>
          <div className="text-sm text-slate-500 mt-4">
            {sniffed.length} archivo{sniffed.length !== 1 ? 's' : ''} detectados
          </div>
          {periodMismatch && (
            <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-4">
              <AlertTriangle size={13} />
              Los archivos tienen períodos distintos — verificá antes de procesar
            </div>
          )}
        </div>
      </div>

      {/* Files table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-3">Archivo</th>
              <th className="px-4 py-3 w-28">Tipo</th>
              <th className="px-4 py-3 w-40">Empresa</th>
              <th className="px-4 py-3 w-28">Período leído</th>
              <th className="px-4 py-3 w-20 text-right">Tamaño</th>
            </tr>
          </thead>
          <tbody>
            {sniffed.map((s, i) => (
              <tr key={i} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet size={15} className="text-slate-400 shrink-0" />
                    <span className="text-slate-800 truncate max-w-xs" title={s.filename}>
                      {s.filename}
                    </span>
                    {s.error && (
                      <span className="text-xs text-red-600 ml-1" title={s.error}>
                        ⚠ error
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium', typeColor(s))}>
                    {typeLabel(s)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {s.type === 'ledger' ? (
                    <select
                      value={empresas[i] ?? ''}
                      onChange={(e) =>
                        onEmpresaChange(i, (e.target.value as Empresa) || null)
                      }
                      className={clsx(
                        'border rounded px-2 py-1 text-xs w-full bg-white focus:outline-none focus:border-brand-500',
                        !empresas[i] ? 'border-red-300 bg-red-50' : 'border-slate-300',
                      )}
                    >
                      <option value="">Seleccioná…</option>
                      {EMPRESAS.map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-slate-400 text-xs">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                  {s.periodo
                    ? fmtPeriodo(s.periodo)
                    : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400 text-right tabular-nums">
                  {fmtBytes(s.size)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Existing batch warning */}
      {periodoValid && (
        <div>
          {checkLoading && (
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Verificando período…
            </div>
          )}
          {!checkLoading && !existingBatch && (
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              <CheckCircle2 size={15} /> Período libre — no hay datos cargados.
            </div>
          )}
          {existingBatch && (
            <div className="bg-amber-50 border border-amber-300 rounded-md px-4 py-3 text-sm">
              <div className="flex items-start gap-2 text-amber-900 mb-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <div>
                  <strong>Ya hay datos para {fmtPeriodo(existingBatch.periodo)}</strong>
                  <span className="text-xs text-amber-700 block mt-0.5">
                    {existingBatch.stats.movementsInserted} movimientos ·
                    CMV ajustado ${fmtMoney(existingBatch.stats.cmvAjustado)} ·
                    Cargado {new Date(existingBatch.createdAt).toLocaleString('es-AR')}
                  </span>
                </div>
              </div>
              <p className="text-xs text-amber-800 ml-6">
                Usá <strong>Reemplazar período</strong> para sobrescribir, o cambiá el período arriba.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Validation issues */}
      {duplicateEmpresa && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          <AlertCircle size={15} />
          Dos archivos tienen la misma empresa asignada — cada empresa debe aparecer una sola vez.
        </div>
      )}

      {/* Action bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          disabled={!canSubmit || !!duplicateEmpresa || !!existingBatch}
          onClick={() => onSubmit(false)}
          className={clsx(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            canSubmit && !duplicateEmpresa && !existingBatch
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed',
          )}
        >
          {ingesting ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          Procesar
        </button>

        {existingBatch && (
          <button
            type="button"
            disabled={!canSubmit || !!duplicateEmpresa}
            onClick={() => {
              if (
                window.confirm(
                  `Esto borrará el batch existente para ${existingBatch.periodo} ` +
                    `(${existingBatch.stats.movementsInserted} movs) y lo reemplazará. ¿Confirmás?`,
                )
              ) {
                onSubmit(true);
              }
            }}
            className={clsx(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              canSubmit && !duplicateEmpresa
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed',
            )}
          >
            <Trash2 size={15} /> Reemplazar período
          </button>
        )}

        <button
          type="button"
          onClick={onReset}
          disabled={ingesting}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          <X size={14} /> Limpiar
        </button>
      </div>
    </div>
  );
}

// ── ResultPanel ─────────────────────────────────────────────────────────────

function ResultPanel({ result }: { result: IngestaResult }) {
  const totalWarnings =
    result.warnings.parser.length +
    result.warnings.enrichment.length +
    result.warnings.inventory.length +
    result.warnings.cmv.length;

  const hasCMV = result.stats.inventoryItems > 0;

  return (
    <section className="bg-white rounded-lg border border-emerald-200 p-6">
      <div className="flex items-start gap-3 mb-5">
        <CheckCircle2 size={24} className="text-emerald-600 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            Ingesta completada — {fmtPeriodo(result.periodo)}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Batch <code className="font-mono">{result.batchId}</code>
          </p>
        </div>
      </div>

      <div className="mb-5">
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Archivos procesados
        </h4>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {result.files.map((f) => (
            <div key={f.name} className="flex justify-between text-slate-700">
              <span className="truncate mr-2">
                {f.kind === 'inventory' ? 'Inventario' : f.empresa}
              </span>
              <span className="text-slate-500">{f.rowsProcessed} filas</span>
            </div>
          ))}
        </div>
      </div>

      {hasCMV && (
        <div className="mb-5">
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            CMV (consolidado, imputado a SUPERBOL)
          </h4>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="Stock Inicial" value={result.stats.stockInicial} />
            <Stat label="Compras" value={result.stats.compras} />
            <Stat label="Stock Final" value={result.stats.stockFinal} />
            <Stat label="CMV Bruto" value={result.stats.cmvBruto} />
            <Stat
              label="Costo Financiero"
              value={result.stats.costoFinanciero}
              hint={result.stats.costoFinanciero >= 0 ? 'ganancia' : 'pérdida'}
            />
            <Stat label="CMV Ajustado" value={result.stats.cmvAjustado} highlight />
          </dl>
        </div>
      )}
      {!hasCMV && (
        <div className="mb-5 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded px-3 py-2">
          No se incluyó archivo de inventario — CMV no calculado para este batch.
        </div>
      )}

      {totalWarnings > 0 && (
        <div className="border-t border-slate-200 pt-4">
          <div className="flex items-center gap-2 mb-2 text-amber-800">
            <AlertTriangle size={14} />
            <h4 className="text-sm font-medium">
              {totalWarnings} advertencia{totalWarnings !== 1 ? 's' : ''}
            </h4>
          </div>
          <ul className="text-xs text-slate-600 space-y-1">
            {result.warnings.parser.map((w, i) => (
              <li key={`p-${i}`}><code className="text-slate-400">[parser/{w.code}]</code> {w.message}</li>
            ))}
            {result.warnings.enrichment.map((w, i) => (
              <li key={`e-${i}`}>
                <code className="text-slate-400">[enrich/{w.code}]</code> {w.message}
                {w.occurrences > 1 && <span className="text-slate-400"> ×{w.occurrences}</span>}
              </li>
            ))}
            {result.warnings.inventory.map((w, i) => (
              <li key={`i-${i}`}><code className="text-slate-400">[inv/{w.code}]</code> {w.message}</li>
            ))}
            {result.warnings.cmv.map((w, i) => (
              <li key={`c-${i}`}><code className="text-slate-400">[cmv/{w.code}]</code> {w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({
  label, value, hint, highlight,
}: {
  label: string; value: number; hint?: string; highlight?: boolean;
}) {
  return (
    <div className={clsx('rounded-md px-3 py-2', highlight ? 'bg-brand-50 border border-brand-200' : 'bg-slate-50')}>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={clsx('font-semibold tabular-nums', highlight ? 'text-brand-800' : 'text-slate-900')}>
        $ {fmtMoney(value)}
      </dd>
      {hint && <span className="text-xs text-slate-400">({hint})</span>}
    </div>
  );
}

// ── BatchList ────────────────────────────────────────────────────────────────

type BatchFile = {
  name: string;
  kind: 'ledger' | 'inventory';
  empresa: Empresa | null;
  rowsProcessed: number;
};

type Batch = {
  _id: string;
  periodo: string;
  status: string;
  createdAt: string;
  files: BatchFile[];
  stats: { movementsInserted: number };
};

function BatchList({ className }: { className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ingesta-batches'],
    queryFn: async () =>
      (await api.get<{ count: number; batches: Batch[] }>('/ingesta')).data,
    staleTime: 10_000,
  });

  const successful = (data?.batches ?? []).filter((b) => b.status === 'success');

  if (isLoading) return null;
  if (!successful.length) return null;

  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Períodos cargados</h3>
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-left text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-2.5">Período</th>
              <th className="px-4 py-2.5">Archivos cargados</th>
              <th className="px-4 py-2.5 text-right">Movimientos</th>
            </tr>
          </thead>
          <tbody>
            {successful.map((b) => {
              const ledgers = b.files.filter((f) => f.kind === 'ledger');
              const hasInv = b.files.some((f) => f.kind === 'inventory');
              return (
                <tr key={b._id} className="border-t border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                    {fmtPeriodo(b.periodo)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5">
                      {ledgers.map((f) => (
                        <span
                          key={f.name}
                          className="px-2 py-0.5 bg-brand-50 text-brand-700 border border-brand-100 rounded text-[10px] font-medium"
                        >
                          {f.empresa ?? f.name}
                        </span>
                      ))}
                      {hasInv && (
                        <span className="px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-100 rounded text-[10px] font-medium">
                          Inventario
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                    {b.stats.movementsInserted.toLocaleString('es-AR')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
