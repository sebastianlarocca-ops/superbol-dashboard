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
  XCircle,
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

type CheckResponse = {
  periodo: string;
  ledgers: {
    empresa: Empresa;
    batchId: string;
    createdAt: string;
    rowsProcessed: number;
  }[];
  inventory: {
    batchId: string;
    createdAt: string;
    rowsProcessed: number;
    stats: {
      inventoryItems: number;
      cmvAjustado: number;
    };
  } | null;
};

type LedgerOutcome =
  | {
      kind: 'ledger';
      empresa: Empresa;
      status: 'success';
      batchId: string;
      rowsProcessed: number;
      warnings: {
        parser: { code: string; message: string; rowNumber?: number }[];
        enrichment: { code: string; message: string; occurrences: number }[];
      };
    }
  | {
      kind: 'ledger';
      empresa: Empresa;
      status: 'failed';
      error: string;
      warnings: {
        parser: { code: string; message: string; rowNumber?: number }[];
        enrichment: { code: string; message: string; occurrences: number }[];
      };
    };

type InventoryOutcome =
  | {
      kind: 'inventory';
      status: 'success';
      batchId: string;
      itemsProcessed: number;
      warnings: { inventory: { code: string; message: string }[] };
    }
  | {
      kind: 'inventory';
      status: 'failed';
      error: string;
      warnings: { inventory: { code: string; message: string }[] };
    };

type CMVOutcome = {
  inventoryBatchId: string;
  totals: {
    stockInicial: number;
    compras: number;
    stockFinal: number;
    cmvBruto: number;
    costoFinanciero: number;
    cmvAjustado: number;
  };
  pseudoMovementsInserted: number;
  warnings: { code: string; message: string }[];
};

type IngestaResult = {
  periodo: string;
  ledgers: LedgerOutcome[];
  inventory: InventoryOutcome | null;
  cmv: CMVOutcome | null;
};

// State machine stages
type Stage =
  | { type: 'idle' }
  | { type: 'sniffing' }
  | {
      type: 'confirm';
      droppedFiles: File[];
      sniffed: SniffResult[];
      empresas: (Empresa | null)[];
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
      fd.append('periodo', stage.periodo);
      for (let i = 0; i < stage.droppedFiles.length; i++) {
        const sniff = stage.sniffed[i];
        const file = stage.droppedFiles[i];
        if (sniff.type === 'inventory') {
          fd.append('inventory', file);
        } else if (sniff.type === 'ledger') {
          const emp = stage.empresas[i];
          if (emp) fd.append(`ledger_${emp}`, file);
        }
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
      qc.invalidateQueries({ queryKey: ['ingesta-batches'] });
      qc.invalidateQueries({ queryKey: ['periodos'] });
    },
    onError: (err: unknown) => {
      const e = err as {
        response?: { status?: number; data?: { error?: string } };
      };
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
    <div className="ds-fade-in" style={{ padding: '28px 36px 80px', maxWidth: 980, margin: '0 auto' }}>
      <header className="ds-page-header">
        <div>
          <h1 className="ds-page-title">Ingesta mensual</h1>
          <p className="ds-page-subtitle">
            Arrastrá uno o varios archivos. El sistema detecta el tipo y período de cada uno.
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
          className="text-center cursor-pointer transition-all"
          style={{
            border: '1.5px dashed',
            borderColor: isDragging ? 'var(--gain)' : 'var(--border)',
            background: isDragging
              ? 'oklch(0.78 0.18 152 / 0.04)'
              : 'var(--bg-surface)',
            borderRadius: 'var(--r-lg)',
            padding: '52px 32px 40px',
          }}
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
            <div className="flex flex-col items-center gap-3" style={{ color: 'var(--fg-tertiary)' }}>
              <Loader2 size={32} className="animate-spin" style={{ color: 'var(--neutral)' }} />
              <p className="text-sm font-medium">Analizando archivos…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div
                className="grid place-items-center"
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 'var(--r-lg)',
                  background: 'var(--bg-surface-2)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--fg-secondary)',
                }}
              >
                <Upload size={24} />
              </div>
              <div>
                <p className="text-base font-medium" style={{ color: 'var(--fg-primary)' }}>
                  Arrastrá o hacé click para seleccionar
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--fg-tertiary)' }}>
                  Mayor por empresa (uno o más) · Inventario consolidado
                </p>
                <p className="text-[11px] mt-2" style={{ color: 'var(--fg-quaternary)' }}>
                  .xls / .xlsx
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {stage.type === 'confirm' && (
        <ConfirmStage
          stage={stage}
          existing={checkQuery.data ?? null}
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
        />
      )}
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

      {(stage.type === 'idle' || stage.type === 'done') && (
        <BatchList className="mt-8" />
      )}
    </div>
  );
}

// ── ConfirmStage ────────────────────────────────────────────────────────────

function ConfirmStage({
  stage,
  existing,
  checkLoading,
  ingesting,
  onPeriodoChange,
  onEmpresaChange,
  onSubmit,
  onReset,
}: {
  stage: Extract<Stage, { type: 'confirm' }>;
  existing: CheckResponse | null;
  checkLoading: boolean;
  ingesting: boolean;
  onPeriodoChange: (p: string) => void;
  onEmpresaChange: (idx: number, e: Empresa | null) => void;
  onSubmit: (force: boolean) => void;
  onReset: () => void;
}) {
  const { sniffed, empresas, periodo } = stage;
  const periodoValid = PERIODO_RE.test(periodo);

  // Per-empresa & inventory conflict detection
  const requestedEmpresas = new Set<Empresa>();
  for (let i = 0; i < sniffed.length; i++) {
    if (sniffed[i].type === 'ledger' && empresas[i]) {
      requestedEmpresas.add(empresas[i] as Empresa);
    }
  }
  const requestedInventory = sniffed.some((s) => s.type === 'inventory');
  const existingEmpresas = new Set(
    (existing?.ledgers ?? []).map((l) => l.empresa),
  );
  const conflictEmpresas = [...requestedEmpresas].filter((e) =>
    existingEmpresas.has(e),
  );
  const inventoryConflict = requestedInventory && !!existing?.inventory;
  const hasConflict = conflictEmpresas.length > 0 || inventoryConflict;

  // Validation
  const ledgersMissingEmpresa = sniffed.some(
    (s, i) => s.type === 'ledger' && !empresas[i],
  );
  const hasLedgerOrInventory = sniffed.some(
    (s) => s.type === 'ledger' || s.type === 'inventory',
  );

  const empCounts: Partial<Record<Empresa, number>> = {};
  sniffed.forEach((s, i) => {
    if (s.type === 'ledger' && empresas[i]) {
      const e = empresas[i]!;
      empCounts[e] = (empCounts[e] ?? 0) + 1;
    }
  });
  const duplicateEmpresa = Object.values(empCounts).some((c) => (c ?? 0) > 1);

  const detectedPeriods = new Set(
    sniffed.filter((s) => s.type === 'ledger' && s.periodo).map((s) => s.periodo),
  );
  const periodMismatch = detectedPeriods.size > 1;

  const canSubmit =
    periodoValid &&
    hasLedgerOrInventory &&
    !ledgersMissingEmpresa &&
    !duplicateEmpresa &&
    !ingesting;

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
            {sniffed.map((s, i) => {
              const emp = empresas[i];
              const conflicts =
                (s.type === 'ledger' && emp && existingEmpresas.has(emp)) ||
                (s.type === 'inventory' && !!existing?.inventory);
              return (
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
                      {conflicts && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium"
                          title="Ya hay datos para esta empresa/inventario en el período"
                        >
                          conflicto
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
                        value={emp ?? ''}
                        onChange={(e) =>
                          onEmpresaChange(i, (e.target.value as Empresa) || null)
                        }
                        className={clsx(
                          'border rounded px-2 py-1 text-xs w-full bg-white focus:outline-none focus:border-brand-500',
                          !emp ? 'border-red-300 bg-red-50' : 'border-slate-300',
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
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Existing-data summary + per-empresa conflict warning */}
      {periodoValid && (
        <div>
          {checkLoading && (
            <div className="text-xs text-slate-400 flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Verificando período…
            </div>
          )}
          {!checkLoading && existing && (
            (existing.ledgers.length === 0 && !existing.inventory) ? (
              <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                <CheckCircle2 size={15} /> Período libre — no hay datos cargados.
              </div>
            ) : !hasConflict ? (
              <div className="flex items-start gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
                <CheckCircle2 size={15} className="mt-0.5 text-emerald-600" />
                <div>
                  Ya hay datos para {fmtPeriodo(existing.periodo)} (
                  {[
                    ...existing.ledgers.map((l) => l.empresa),
                    ...(existing.inventory ? ['Inventario'] : []),
                  ].join(', ')}
                  ).
                  <span className="text-slate-500"> Esta carga agrega sin tocar lo existente.</span>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50 border border-amber-300 rounded-md px-4 py-3 text-sm">
                <div className="flex items-start gap-2 text-amber-900 mb-1">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                  <div>
                    <strong>
                      Conflicto en {fmtPeriodo(existing.periodo)}:{' '}
                      {[
                        ...conflictEmpresas,
                        ...(inventoryConflict ? ['inventario'] : []),
                      ].join(', ')}
                    </strong>
                    <p className="text-xs text-amber-800 mt-1">
                      Se va a reemplazar solo lo conflictivo. Las otras empresas del período no se tocan.
                    </p>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}

      {duplicateEmpresa && (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          <AlertCircle size={15} />
          Dos archivos tienen la misma empresa asignada — cada empresa debe aparecer una sola vez.
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        {!hasConflict && (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onSubmit(false)}
            className={clsx(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              canSubmit
                ? 'bg-brand-600 text-white hover:bg-brand-700'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed',
            )}
          >
            {ingesting ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            Procesar
          </button>
        )}

        {hasConflict && (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              const labels = [
                ...conflictEmpresas,
                ...(inventoryConflict ? ['inventario'] : []),
              ].join(', ');
              if (
                window.confirm(
                  `Esto va a reemplazar los datos de ${labels} en ${fmtPeriodo(periodo)}. ` +
                    `Las otras empresas del período no se tocan. ¿Confirmás?`,
                )
              ) {
                onSubmit(true);
              }
            }}
            className={clsx(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              canSubmit
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed',
            )}
          >
            {ingesting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
            Reemplazar {conflictEmpresas.length + (inventoryConflict ? 1 : 0)} en conflicto
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
  const ledgerSuccesses = result.ledgers.filter((l) => l.status === 'success');
  const ledgerFailures = result.ledgers.filter((l) => l.status === 'failed');
  const invStatus = result.inventory?.status;
  const hasFailure = ledgerFailures.length > 0 || invStatus === 'failed';
  const hasCMV = !!result.cmv;

  const totalWarnings =
    result.ledgers.reduce(
      (acc, l) => acc + l.warnings.parser.length + l.warnings.enrichment.length,
      0,
    ) +
    (result.inventory?.warnings.inventory.length ?? 0) +
    (result.cmv?.warnings.length ?? 0);

  return (
    <section
      className={clsx(
        'bg-white rounded-lg border p-6',
        hasFailure ? 'border-amber-300' : 'border-emerald-200',
      )}
    >
      <div className="flex items-start gap-3 mb-5">
        {hasFailure ? (
          <AlertTriangle size={24} className="text-amber-600 shrink-0 mt-0.5" />
        ) : (
          <CheckCircle2 size={24} className="text-emerald-600 shrink-0 mt-0.5" />
        )}
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {hasFailure ? 'Ingesta parcial' : 'Ingesta completada'} — {fmtPeriodo(result.periodo)}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {ledgerSuccesses.length} mayor{ledgerSuccesses.length !== 1 ? 'es' : ''} cargado
            {ledgerSuccesses.length !== 1 ? 's' : ''}
            {invStatus === 'success' && ' · inventario OK'}
            {ledgerFailures.length > 0 && ` · ${ledgerFailures.length} fallaron`}
            {invStatus === 'failed' && ' · inventario falló'}
          </p>
        </div>
      </div>

      <div className="mb-5">
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Por archivo
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {result.ledgers.map((l) => (
            <div
              key={l.empresa}
              className="flex justify-between items-center text-slate-700 py-0.5"
            >
              <span className="flex items-center gap-1.5">
                {l.status === 'success' ? (
                  <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                ) : (
                  <XCircle size={13} className="text-red-500 shrink-0" />
                )}
                {l.empresa}
              </span>
              <span className="text-slate-500 text-xs">
                {l.status === 'success'
                  ? `${l.rowsProcessed} mov${l.rowsProcessed !== 1 ? 's' : ''}`
                  : 'falló'}
              </span>
            </div>
          ))}
          {result.inventory && (
            <div className="flex justify-between items-center text-slate-700 py-0.5">
              <span className="flex items-center gap-1.5">
                {result.inventory.status === 'success' ? (
                  <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                ) : (
                  <XCircle size={13} className="text-red-500 shrink-0" />
                )}
                Inventario
              </span>
              <span className="text-slate-500 text-xs">
                {result.inventory.status === 'success'
                  ? `${result.inventory.itemsProcessed} ítems`
                  : 'falló'}
              </span>
            </div>
          )}
        </div>
      </div>

      {ledgerFailures.length > 0 && (
        <div className="mb-5">
          <h4 className="text-xs font-medium text-red-700 uppercase tracking-wide mb-2">
            Errores
          </h4>
          <ul className="text-xs text-red-700 space-y-1">
            {ledgerFailures.map((l) => (
              <li key={l.empresa}>
                <strong>{l.empresa}:</strong>{' '}
                {l.status === 'failed' ? l.error : ''}
              </li>
            ))}
            {invStatus === 'failed' && result.inventory && (
              <li>
                <strong>Inventario:</strong>{' '}
                {result.inventory.status === 'failed' ? result.inventory.error : ''}
              </li>
            )}
          </ul>
        </div>
      )}

      {hasCMV && result.cmv && (
        <div className="mb-5">
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            CMV (consolidado, imputado a SUPERBOL)
          </h4>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="Stock Inicial" value={result.cmv.totals.stockInicial} />
            <Stat label="Compras" value={result.cmv.totals.compras} />
            <Stat label="Stock Final" value={result.cmv.totals.stockFinal} />
            <Stat label="CMV Bruto" value={result.cmv.totals.cmvBruto} />
            <Stat
              label="Costo Financiero"
              value={result.cmv.totals.costoFinanciero}
              hint={result.cmv.totals.costoFinanciero >= 0 ? 'ganancia' : 'pérdida'}
            />
            <Stat label="CMV Ajustado" value={result.cmv.totals.cmvAjustado} highlight />
          </dl>
        </div>
      )}
      {!hasCMV && (
        <div className="mb-5 text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded px-3 py-2">
          Sin inventario para el período — CMV no calculado.
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
            {result.ledgers.flatMap((l) =>
              l.warnings.parser.map((w, i) => (
                <li key={`p-${l.empresa}-${i}`}>
                  <code className="text-slate-400">[{l.empresa}/parser/{w.code}]</code> {w.message}
                </li>
              )),
            )}
            {result.ledgers.flatMap((l) =>
              l.warnings.enrichment.map((w, i) => (
                <li key={`e-${l.empresa}-${i}`}>
                  <code className="text-slate-400">[{l.empresa}/enrich/{w.code}]</code> {w.message}
                  {w.occurrences > 1 && <span className="text-slate-400"> ×{w.occurrences}</span>}
                </li>
              )),
            )}
            {result.inventory?.warnings.inventory.map((w, i) => (
              <li key={`i-${i}`}>
                <code className="text-slate-400">[inv/{w.code}]</code> {w.message}
              </li>
            ))}
            {result.cmv?.warnings.map((w, i) => (
              <li key={`c-${i}`}>
                <code className="text-slate-400">[cmv/{w.code}]</code> {w.message}
              </li>
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

type PeriodoGroup = {
  periodo: string;
  ledgers: {
    empresa: Empresa;
    batchId: string;
    createdAt: string;
    rowsProcessed: number;
  }[];
  inventory: {
    batchId: string;
    createdAt: string;
    rowsProcessed: number;
  } | null;
  totalMovements: number;
  cmvAjustado: number;
  lastUpdated: string;
};

function BatchList({ className }: { className?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ingesta-batches'],
    queryFn: async () =>
      (await api.get<{ count: number; periodos: PeriodoGroup[] }>('/ingesta')).data,
    staleTime: 10_000,
  });

  if (isLoading) return null;
  const periodos = data?.periodos ?? [];
  if (!periodos.length) return null;

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
            {periodos.map((g) => (
              <tr key={g.periodo} className="border-t border-slate-100 hover:bg-slate-50/50">
                <td className="px-4 py-2.5 font-medium text-slate-800 whitespace-nowrap">
                  {fmtPeriodo(g.periodo)}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-1.5">
                    {g.ledgers.map((l) => (
                      <span
                        key={l.empresa}
                        className="px-2 py-0.5 bg-brand-50 text-brand-700 border border-brand-100 rounded text-[10px] font-medium"
                      >
                        {l.empresa}
                      </span>
                    ))}
                    {g.inventory && (
                      <span className="px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-100 rounded text-[10px] font-medium">
                        Inventario
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                  {g.totalMovements.toLocaleString('es-AR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
