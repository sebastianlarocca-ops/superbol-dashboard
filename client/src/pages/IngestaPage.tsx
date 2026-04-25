import { useState, useMemo, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/axios';

const EMPRESAS = ['SUPERBOL', 'PRUEBAS', 'SUSTEN', 'POINT'] as const;
type Empresa = (typeof EMPRESAS)[number];

type CheckResponse =
  | { exists: false; periodo: string }
  | {
      exists: true;
      periodo: string;
      batchId: string;
      status: 'pending' | 'processing' | 'success' | 'failed';
      createdAt: string;
      files: {
        name: string;
        hash: string;
        kind: 'ledger' | 'inventory';
        empresa: Empresa | null;
        rowsProcessed: number;
      }[];
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
  files: {
    name: string;
    kind: 'ledger' | 'inventory';
    empresa: Empresa | null;
    rowsProcessed: number;
  }[];
  warnings: {
    parser: { code: string; message: string; rowNumber?: number }[];
    enrichment: { code: string; message: string; occurrences: number }[];
    inventory: { code: string; message: string }[];
    cmv: { code: string; message: string }[];
  };
};

const fmtMoney = (n: number) =>
  n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const todayPeriod = (): string => {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

const PERIODO_RE = /^\d{2}\/\d{4}$/;

export function IngestaPage() {
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState<string>(todayPeriod());
  const [inventoryFile, setInventoryFile] = useState<File | null>(null);
  const [ledgers, setLedgers] = useState<Record<Empresa, File | null>>({
    SUPERBOL: null,
    PRUEBAS: null,
    SUSTEN: null,
    POINT: null,
  });
  const [result, setResult] = useState<IngestaResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const periodoValid = PERIODO_RE.test(periodo);

  // Pre-flight check: does this period already have a batch?
  const checkQuery = useQuery({
    queryKey: ['ingesta-check', periodo],
    queryFn: async () => (await api.get<CheckResponse>(`/ingesta/check?periodo=${periodo}`)).data,
    enabled: periodoValid,
    staleTime: 5_000,
  });

  const hasFiles = useMemo(
    () => inventoryFile !== null || Object.values(ledgers).some((f) => f !== null),
    [inventoryFile, ledgers],
  );
  const hasAtLeastOneLedger = useMemo(
    () => Object.values(ledgers).some((f) => f !== null),
    [ledgers],
  );
  const canSubmit = periodoValid && inventoryFile !== null && hasAtLeastOneLedger;

  // Mutation: POST /ingesta with multipart
  const ingestaMutation = useMutation({
    mutationFn: async ({ force }: { force: boolean }) => {
      const fd = new FormData();
      if (inventoryFile) fd.append('inventory', inventoryFile);
      for (const e of EMPRESAS) {
        const f = ledgers[e];
        if (f) fd.append(`ledger_${e}`, f);
      }
      const url = force ? '/ingesta?force=true' : '/ingesta';
      const res = await api.post<IngestaResult>(url, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 5 * 60_000, // 5 min — large bulk inserts can take a while
      });
      return res.data;
    },
    onSuccess: (data) => {
      setResult(data);
      setErrorMessage(null);
      qc.invalidateQueries({ queryKey: ['ingesta-check'] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { status?: number; data?: { error?: string } } };
      const status = e.response?.status;
      const msg = e.response?.data?.error ?? (err instanceof Error ? err.message : String(err));
      if (status === 409) {
        setErrorMessage(`${msg}`);
      } else {
        setErrorMessage(msg);
      }
    },
  });

  const handleSubmit = useCallback(
    (force: boolean) => {
      setResult(null);
      setErrorMessage(null);
      ingestaMutation.mutate({ force });
    },
    [ingestaMutation],
  );

  const handleClear = useCallback(() => {
    setInventoryFile(null);
    setLedgers({ SUPERBOL: null, PRUEBAS: null, SUSTEN: null, POINT: null });
    setResult(null);
    setErrorMessage(null);
  }, []);

  // Did the user pick a period that's already loaded?
  const existingBatch =
    checkQuery.data && checkQuery.data.exists ? checkQuery.data : null;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <h2 className="text-2xl font-semibold text-slate-900">Ingesta mensual</h2>
        <p className="text-sm text-slate-500 mt-1">
          Subí los 4 mayores (uno por empresa) y el archivo consolidado de inventario para
          procesar el cierre del mes.
        </p>
      </header>

      {/* Period picker */}
      <section className="bg-white rounded-lg border border-slate-200 p-6 mb-6">
        <label htmlFor="periodo" className="block text-sm font-medium text-slate-700 mb-2">
          Período
        </label>
        <div className="flex items-center gap-3">
          <input
            id="periodo"
            type="text"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            placeholder="MM/YYYY"
            className={clsx(
              'px-3 py-2 border rounded-md text-sm w-32 font-mono',
              periodoValid ? 'border-slate-300' : 'border-red-400 bg-red-50',
            )}
          />
          <span className="text-xs text-slate-500">formato MM/YYYY (ej. 07/2025)</span>
        </div>

        {/* Pre-check banner */}
        {periodoValid && (
          <div className="mt-4">
            {checkQuery.isLoading && (
              <div className="text-sm text-slate-500 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Consultando estado del período…
              </div>
            )}
            {checkQuery.data && !existingBatch && (
              <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                <CheckCircle2 size={16} /> Período libre — no hay datos cargados todavía.
              </div>
            )}
            {existingBatch && (
              <div className="flex flex-col gap-2 text-sm bg-amber-50 border border-amber-300 rounded-md px-4 py-3">
                <div className="flex items-start gap-2 text-amber-900">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <strong>Ya hay datos cargados para {existingBatch.periodo}</strong>
                    <span className="text-xs text-amber-800 block mt-0.5">
                      Cargado el {new Date(existingBatch.createdAt).toLocaleString('es-AR')} —
                      batch <code className="font-mono">{existingBatch.batchId.slice(-8)}</code>
                    </span>
                  </div>
                </div>
                <div className="ml-6 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-amber-900">
                  <span>
                    <strong>{existingBatch.stats.movementsInserted}</strong> movimientos
                  </span>
                  <span>
                    <strong>{existingBatch.stats.inventoryItems}</strong> ítems de inventario
                  </span>
                  <span>
                    <strong>$ {fmtMoney(existingBatch.stats.cmvAjustado)}</strong> CMV ajustado
                  </span>
                  <span>
                    Empresas:{' '}
                    {existingBatch.files
                      .filter((f) => f.kind === 'ledger')
                      .map((f) => `${f.empresa} (${f.rowsProcessed})`)
                      .join(', ')}
                  </span>
                </div>
                <div className="ml-6 text-xs text-amber-800">
                  Si querés <strong>reemplazar</strong> los datos, subí los archivos y usá el
                  botón "Reemplazar período". Si no, cambiá el período arriba.
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Drop zones */}
      <section className="bg-white rounded-lg border border-slate-200 p-6 mb-6">
        <h3 className="text-sm font-medium text-slate-700 mb-4">Archivos</h3>

        <DropZone
          label="Inventario (consolidado)"
          accept=".xlsx,.xls"
          file={inventoryFile}
          onChange={setInventoryFile}
          required
          hint="Pestaña INFORME del Excel de stock"
        />

        <div className="mt-4 grid grid-cols-2 gap-3">
          {EMPRESAS.map((e) => (
            <DropZone
              key={e}
              label={`Mayor — ${e}`}
              accept=".xls,.xlsx"
              file={ledgers[e]}
              onChange={(f) => setLedgers((prev) => ({ ...prev, [e]: f }))}
              hint={e === 'SUPERBOL' ? 'Operativa principal' : 'Empresa pantalla'}
            />
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
          <span>
            Inventario:{' '}
            <strong className={inventoryFile ? 'text-emerald-700' : 'text-slate-400'}>
              {inventoryFile ? '✓' : 'falta'}
            </strong>
          </span>
          <span>·</span>
          <span>
            Mayores:{' '}
            <strong>{Object.values(ledgers).filter(Boolean).length}</strong> de 4 (mínimo 1)
          </span>
        </div>
      </section>

      {/* Action bar */}
      <section className="flex items-center gap-3 mb-6">
        <button
          type="button"
          disabled={!canSubmit || ingestaMutation.isPending}
          onClick={() => handleSubmit(false)}
          className={clsx(
            'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            canSubmit && !ingestaMutation.isPending
              ? 'bg-brand-600 text-white hover:bg-brand-700'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed',
          )}
        >
          {ingestaMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Upload size={16} />
          )}
          {existingBatch ? 'Procesar (cancelará si ya existe)' : 'Procesar'}
        </button>

        {existingBatch && (
          <button
            type="button"
            disabled={!canSubmit || ingestaMutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Esto va a borrar el batch existente para ${existingBatch.periodo} (${existingBatch.stats.movementsInserted} movs) y reemplazarlo con los archivos nuevos. ¿Confirmás?`,
                )
              ) {
                handleSubmit(true);
              }
            }}
            className={clsx(
              'inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
              canSubmit && !ingestaMutation.isPending
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-slate-200 text-slate-400 cursor-not-allowed',
            )}
          >
            <Trash2 size={16} /> Reemplazar período
          </button>
        )}

        {hasFiles && !ingestaMutation.isPending && (
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-600 hover:bg-slate-100"
          >
            <X size={14} /> Limpiar
          </button>
        )}
      </section>

      {/* Error */}
      {errorMessage && (
        <section className="bg-red-50 border border-red-300 rounded-md p-4 mb-6">
          <div className="flex gap-2 text-red-800">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <div className="text-sm">
              <strong>Error en ingesta:</strong> {errorMessage}
            </div>
          </div>
        </section>
      )}

      {/* Result */}
      {result && <ResultPanel result={result} />}
    </div>
  );
}

// ─── DropZone ───────────────────────────────────────────────────────────────

type DropZoneProps = {
  label: string;
  accept: string;
  file: File | null;
  onChange: (f: File | null) => void;
  required?: boolean;
  hint?: string;
};

function DropZone({ label, accept, file, onChange, required, hint }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) onChange(f);
      }}
      className={clsx(
        'border-2 border-dashed rounded-md p-3 cursor-pointer transition-colors',
        isDragging
          ? 'border-brand-500 bg-brand-50'
          : file
            ? 'border-emerald-300 bg-emerald-50/40'
            : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <div className="flex items-center gap-3">
        <FileSpreadsheet
          size={24}
          className={file ? 'text-emerald-600' : 'text-slate-400'}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-800">
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </div>
          {file ? (
            <div className="text-xs text-slate-600 truncate">
              {file.name} <span className="text-slate-400">· {(file.size / 1024).toFixed(0)} KB</span>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              {hint ?? 'Arrastrá o hacé click para seleccionar'}
            </div>
          )}
        </div>
        {file && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
            }}
            className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
            aria-label="Quitar archivo"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ResultPanel ────────────────────────────────────────────────────────────

function ResultPanel({ result }: { result: IngestaResult }) {
  const totalWarnings =
    result.warnings.parser.length +
    result.warnings.enrichment.length +
    result.warnings.inventory.length +
    result.warnings.cmv.length;

  return (
    <section className="bg-white rounded-lg border border-emerald-200 p-6">
      <div className="flex items-start gap-3 mb-5">
        <CheckCircle2 size={24} className="text-emerald-600 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-base font-semibold text-slate-900">
            Ingesta completada — {result.periodo}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Batch <code className="font-mono">{result.batchId}</code>
          </p>
        </div>
      </div>

      {/* Files summary */}
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

      {/* Stats */}
      <div className="mb-5">
        <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
          Resultados del CMV (consolidado, imputado a SUPERBOL)
        </h4>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Stock Inicial" value={result.stats.stockInicial} />
          <Stat label="Compras" value={result.stats.compras} />
          <Stat label="Stock Final" value={result.stats.stockFinal} />
          <Stat label="CMV Bruto" value={result.stats.cmvBruto} />
          <Stat
            label="Costo Financiero"
            value={result.stats.costoFinanciero}
            hint={result.stats.costoFinanciero > 0 ? 'ganancia' : 'pérdida'}
          />
          <Stat label="CMV Ajustado" value={result.stats.cmvAjustado} highlight />
        </dl>
      </div>

      {/* Warnings */}
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
              <li key={`p-${i}`}>
                <code className="text-slate-500">[parser/{w.code}]</code> {w.message}
              </li>
            ))}
            {result.warnings.enrichment.map((w, i) => (
              <li key={`e-${i}`}>
                <code className="text-slate-500">[enrich/{w.code}]</code> {w.message}{' '}
                {w.occurrences > 1 && (
                  <span className="text-slate-400">×{w.occurrences}</span>
                )}
              </li>
            ))}
            {result.warnings.inventory.map((w, i) => (
              <li key={`i-${i}`}>
                <code className="text-slate-500">[inv/{w.code}]</code> {w.message}
              </li>
            ))}
            {result.warnings.cmv.map((w, i) => (
              <li key={`c-${i}`}>
                <code className="text-slate-500">[cmv/{w.code}]</code> {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  highlight,
}: {
  label: string;
  value: number;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={clsx(
        'rounded-md px-3 py-2',
        highlight ? 'bg-brand-50 border border-brand-200' : 'bg-slate-50',
      )}
    >
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        className={clsx(
          'font-semibold tabular-nums',
          highlight ? 'text-brand-800' : 'text-slate-900',
        )}
      >
        ${' '}
        {fmtMoney(value)}
      </dd>
      {hint && <span className="text-xs text-slate-400">({hint})</span>}
    </div>
  );
}
