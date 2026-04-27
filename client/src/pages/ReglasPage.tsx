import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/axios';

// ── Types ─────────────────────────────────────────────────────────────────

type ReimputationRule = {
  _id: string;
  desde: {
    numeroCuenta: string;
    nombreCuenta: string;
    numeroSubcuenta: string | null;
    nombreSubcuenta: string | null;
  };
  hacia: { numeroCuenta: string; nombreCuenta: string };
};

type AnulacionRule = {
  _id: string;
  cuenta: { numeroCuenta: string; nombreCuenta: string };
  subcuenta: { numeroSubcuenta: string; nombreSubcuenta: string };
};

type SubrubroMap = {
  _id: string;
  nombreCuentaReimputada: string;
  nombreSubrubro: string;
};

// ── Collapsible section ────────────────────────────────────────────────────

function Section({
  title,
  badge,
  badgeColor = 'slate',
  children,
  defaultOpen = true,
}: {
  title: string;
  badge?: string | number;
  badgeColor?: 'slate' | 'brand' | 'amber' | 'emerald' | 'violet';
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const badgeClasses: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    brand: 'bg-brand-100 text-brand-700',
    amber: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    violet: 'bg-violet-100 text-violet-700',
  };

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        {open ? (
          <ChevronDown size={15} className="text-slate-400 flex-shrink-0" />
        ) : (
          <ChevronRight size={15} className="text-slate-400 flex-shrink-0" />
        )}
        <span className="font-semibold text-slate-800 text-sm">{title}</span>
        {badge !== undefined && (
          <span
            className={clsx(
              'ml-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
              badgeClasses[badgeColor],
            )}
          >
            {badge}
          </span>
        )}
      </button>
      {open && <div className="p-5 border-t border-slate-200">{children}</div>}
    </div>
  );
}

// ── Shared table styles ────────────────────────────────────────────────────

const thCls = 'px-3 py-2 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wide bg-slate-50 border-b border-slate-200';
const tdCls = 'px-3 py-1.5 text-xs text-slate-700 border-b border-slate-100';
const monoSpan = 'font-mono text-[10px] text-slate-400 mr-1';

// ── ReglasPage ─────────────────────────────────────────────────────────────

export function ReglasPage() {
  const { data: reimputData, isLoading: rLoading } = useQuery({
    queryKey: ['rules-reimputations'],
    queryFn: async () =>
      (await api.get<{ count: number; rules: ReimputationRule[] }>('/rules/reimputations')).data,
    staleTime: 5 * 60_000,
  });

  const { data: anulData, isLoading: aLoading } = useQuery({
    queryKey: ['rules-anulaciones'],
    queryFn: async () =>
      (await api.get<{ count: number; rules: AnulacionRule[] }>('/rules/anulaciones')).data,
    staleTime: 5 * 60_000,
  });

  const { data: subrData, isLoading: sLoading } = useQuery({
    queryKey: ['rules-subrubros'],
    queryFn: async () =>
      (await api.get<{ count: number; rules: SubrubroMap[] }>('/rules/subrubros')).data,
    staleTime: 5 * 60_000,
  });

  // Group subrubros by nombreSubrubro
  const subrGrupos = subrData
    ? subrData.rules.reduce<Record<string, string[]>>((acc, r) => {
        (acc[r.nombreSubrubro] ??= []).push(r.nombreCuentaReimputada);
        return acc;
      }, {})
    : {};
  const subrGrupoKeys = Object.keys(subrGrupos).sort();

  return (
    <div className="ds-fade-in" style={{ padding: '28px 36px 80px', maxWidth: 1180, margin: '0 auto' }}>
      <header className="ds-page-header">
        <div>
          <h1 className="ds-page-title">Reglas y criterios</h1>
          <p className="ds-page-subtitle">
            Documentación de todas las transformaciones que se aplican sobre los movimientos
            importados, en el orden en que se ejecutan.
          </p>
        </div>
      </header>
      <div className="space-y-4">

      {/* ── 1. Clasificación de rubros ─────────────────────────────────── */}
      <Section title="1. Clasificación de rubros" badge="Estático" badgeColor="slate">
        <p className="text-xs text-slate-500 mb-4">
          Cada movimiento recibe un <strong>rubro</strong> según el número de cuenta
          post-reimputación. El rubro determina el signo contable del saldo en los reportes
          (activo/pasivo vs. resultado).
        </p>
        <table className="w-full border border-slate-200 rounded-md overflow-hidden text-xs mb-4">
          <thead>
            <tr>
              <th className={thCls}>Rango de cuenta</th>
              <th className={thCls}>Rubro asignado</th>
              <th className={thCls}>Notas</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={tdCls}><code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">1000 – 2999</code></td>
              <td className={tdCls}><span className="text-blue-700 font-medium">Activo</span></td>
              <td className={tdCls}>Bienes y derechos</td>
            </tr>
            <tr>
              <td className={tdCls}><code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">3000 – 3999</code></td>
              <td className={tdCls}><span className="text-purple-700 font-medium">Pasivo</span></td>
              <td className={tdCls}>Obligaciones</td>
            </tr>
            <tr>
              <td className={tdCls}><code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">6000 – 6999</code></td>
              <td className={tdCls}><span className="text-red-700 font-medium">Resultado negativo</span></td>
              <td className={tdCls}>Egresos / costos / gastos</td>
            </tr>
            <tr>
              <td className={tdCls}><code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">7000 – 7999</code></td>
              <td className={tdCls}><span className="text-emerald-700 font-medium">Resultado positivo</span></td>
              <td className={tdCls}>Ingresos / ventas</td>
            </tr>
            <tr>
              <td className={tdCls}><code className="bg-slate-100 px-1.5 py-0.5 rounded text-[11px]">Resto / no numérico</code></td>
              <td className={tdCls}><span className="text-slate-500 font-medium">Cuentas puentes</span></td>
              <td className={tdCls}>Excluidas del P&L; aparecen como advertencia en ingesta</td>
            </tr>
          </tbody>
        </table>
        <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3 text-xs text-amber-800">
          <strong>Sobreescrituras manuales:</strong>{' '}
          <code className="bg-amber-100 px-1 rounded">f001</code> → Resultado negativo
          (intereses bancarios reimputados a código no numérico).
        </div>
      </Section>

      {/* ── 2. Reimputaciones ─────────────────────────────────────────── */}
      <Section
        title="2. Reimputaciones"
        badge={reimputData ? reimputData.count : '…'}
        badgeColor="brand"
      >
        <p className="text-xs text-slate-500 mb-1">
          Redirigen movimientos de una <strong>cuenta origen</strong> a una{' '}
          <strong>cuenta destino</strong> antes de cualquier cálculo.
          El resultado queda en <code className="bg-slate-100 px-1 rounded">numeroCuentaReimputada</code>.
        </p>
        <p className="text-xs text-slate-500 mb-4">
          <strong>Prioridad:</strong> si existe una regla con subcuenta específica, tiene
          precedencia sobre la regla genérica (sin subcuenta) para la misma cuenta.
          Si ninguna regla aplica, la cuenta pasa sin cambios (<em>pass-through</em>).
        </p>
        {rLoading ? (
          <div className="py-6 text-center text-slate-400">
            <Loader2 size={16} className="animate-spin inline mr-2" />Cargando…
          </div>
        ) : (
          <table className="w-full border border-slate-200 rounded-md overflow-hidden text-xs">
            <thead>
              <tr>
                <th className={thCls}>Cuenta origen</th>
                <th className={thCls}>Subcuenta origen</th>
                <th className={clsx(thCls, 'text-center w-6')}>→</th>
                <th className={thCls}>Cuenta destino</th>
              </tr>
            </thead>
            <tbody>
              {reimputData?.rules.map((r) => (
                <tr key={r._id} className="hover:bg-slate-50/60">
                  <td className={tdCls}>
                    <span className={monoSpan}>{r.desde.numeroCuenta}</span>
                    {r.desde.nombreCuenta}
                  </td>
                  <td className={tdCls}>
                    {r.desde.nombreSubcuenta ? (
                      <>
                        <span className={monoSpan}>{r.desde.numeroSubcuenta}</span>
                        {r.desde.nombreSubcuenta}
                      </>
                    ) : (
                      <span className="text-slate-300 italic">cualquier subcuenta</span>
                    )}
                  </td>
                  <td className={clsx(tdCls, 'text-center text-slate-400')}>→</td>
                  <td className={tdCls}>
                    <span className={monoSpan}>{r.hacia.numeroCuenta}</span>
                    <strong>{r.hacia.nombreCuenta}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── 3. Anulaciones ────────────────────────────────────────────── */}
      <Section
        title="3. Anulaciones"
        badge={anulData ? anulData.count : '…'}
        badgeColor="amber"
      >
        <p className="text-xs text-slate-500 mb-1">
          Los movimientos que coinciden quedan marcados con{' '}
          <code className="bg-slate-100 px-1 rounded">anulacion: true</code>.
          Se excluyen del Estado de Resultados por defecto, pero permanecen en la base
          de datos y son visibles en la pantalla <strong>Movimientos</strong>.
        </p>
        <p className="text-xs text-slate-500 mb-4">
          <strong>Coincidencia exacta</strong> sobre <em>nombreCuenta</em>{' '}
          <strong>y</strong> <em>nombreSubcuenta</em> (ambos requeridos).
        </p>
        {aLoading ? (
          <div className="py-6 text-center text-slate-400">
            <Loader2 size={16} className="animate-spin inline mr-2" />Cargando…
          </div>
        ) : (
          <table className="w-full border border-slate-200 rounded-md overflow-hidden text-xs">
            <thead>
              <tr>
                <th className={thCls}>Cuenta</th>
                <th className={thCls}>Subcuenta</th>
              </tr>
            </thead>
            <tbody>
              {anulData?.rules.map((r) => (
                <tr key={r._id} className="hover:bg-slate-50/60">
                  <td className={tdCls}>
                    <span className={monoSpan}>{r.cuenta.numeroCuenta}</span>
                    {r.cuenta.nombreCuenta}
                  </td>
                  <td className={tdCls}>
                    <span className={monoSpan}>{r.subcuenta.numeroSubcuenta}</span>
                    {r.subcuenta.nombreSubcuenta}
                  </td>
                </tr>
              ))}
              {anulData?.rules.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-4 text-center text-slate-400 text-xs">
                    Sin reglas de anulación cargadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Section>

      {/* ── 4. Subrubros ──────────────────────────────────────────────── */}
      <Section
        title="4. Subrubros"
        badge={subrData ? subrData.count : '…'}
        badgeColor="emerald"
      >
        <p className="text-xs text-slate-500 mb-4">
          Luego de la reimputación, cada cuenta recibe un <strong>subrubro</strong> según
          su nombre reimputado. Los subrubros agrupan cuentas en categorías funcionales
          usadas en el Estado de Resultados, CMV y evolución temporal.
          Coincidencia <strong>case-insensitive</strong> sobre{' '}
          <code className="bg-slate-100 px-1 rounded">nombreCuentaReimputada</code>.
          Sin coincidencia → <code className="bg-slate-100 px-1 rounded">null</code>{' '}
          (aparece como advertencia en ingesta).
        </p>
        {sLoading ? (
          <div className="py-6 text-center text-slate-400">
            <Loader2 size={16} className="animate-spin inline mr-2" />Cargando…
          </div>
        ) : (
          <div className="space-y-3">
            {subrGrupoKeys.map((grupo) => (
              <div key={grupo} className="border border-slate-200 rounded-md overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-700">{grupo}</span>
                  <span className="text-[10px] text-slate-400">
                    {subrGrupos[grupo].length} cuenta{subrGrupos[grupo].length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="px-3 py-2 flex flex-wrap gap-1.5">
                  {subrGrupos[grupo].sort().map((c) => (
                    <span
                      key={c}
                      className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[11px] text-slate-600"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── 5. Cálculo CMV ────────────────────────────────────────────── */}
      <Section title="5. Cálculo de CMV" badge="Estático" badgeColor="violet">
        <p className="text-xs text-slate-500 mb-4">
          El CMV se calcula a partir del inventario mensual (archivo separado) y los
          movimientos del mayor. Se imputa consolidado a <strong>SUPERBOL</strong>.
        </p>

        {/* Fórmulas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-2">Fórmula principal</p>
            <div className="space-y-1 text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="w-4 text-slate-400 text-center">+</span>
                <span>Stock inicial (SI)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 text-slate-400 text-center">+</span>
                <span>Compras del período</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 text-slate-400 text-center">−</span>
                <span>Stock final (SF)</span>
              </div>
              <div className="border-t border-slate-300 pt-1 flex items-center gap-2">
                <span className="w-4 text-center">=</span>
                <span className="font-semibold">CMV Bruto</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 text-slate-400 text-center">−</span>
                <span>Costo financiero</span>
              </div>
              <div className="border-t border-slate-300 pt-1 flex items-center gap-2">
                <span className="w-4 text-center">=</span>
                <span className="font-semibold text-brand-700">CMV Ajustado</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-2">Costo financiero (tenencia)</p>
            <div className="space-y-2 text-xs">
              <div className="bg-white border border-slate-200 rounded p-2">
                <span className="font-semibold text-slate-700">Caso A</span>
                <span className="text-slate-500 ml-1">(SI &gt; SF)</span>
                <p className="text-slate-600 mt-0.5 font-mono">CF = SF × ΔPrecio</p>
                <p className="text-slate-400 text-[10px] mt-0.5">Las unidades que quedaron son las del mes anterior</p>
              </div>
              <div className="bg-white border border-slate-200 rounded p-2">
                <span className="font-semibold text-slate-700">Caso B</span>
                <span className="text-slate-500 ml-1">(SI ≤ SF)</span>
                <p className="text-slate-600 mt-0.5 font-mono">CF = SI × ΔPrecio</p>
                <p className="text-slate-400 text-[10px] mt-0.5">Solo las unidades viejas (SI) se revalorizan</p>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                <strong>Signo:</strong> CF &gt; 0 = ganancia (precio subió), CF &lt; 0 = pérdida.
              </p>
            </div>
          </div>
        </div>

        {/* Cuentas de compras */}
        <div className="mb-5">
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-2">
            Cuentas de compras (pre-reimputación)
          </p>
          <div className="flex gap-2 flex-wrap">
            {['1600', '1620', '6200'].map((c) => (
              <code
                key={c}
                className="px-2.5 py-1 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-700"
              >
                {c}
              </code>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            Se suman <em>antes</em> de la reimputación para que el resultado sea determinístico
            independientemente del estado de las reglas.
          </p>
        </div>

        {/* Pseudo-movimientos */}
        <div>
          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-2">
            Pseudo-movimientos generados (4 por período)
          </p>
          <table className="w-full border border-slate-200 rounded-md overflow-hidden text-xs">
            <thead>
              <tr>
                <th className={clsx(thCls, 'w-6')}>#</th>
                <th className={thCls}>Concepto</th>
                <th className={thCls}>Cuenta</th>
                <th className={thCls}>Debe / Haber</th>
              </tr>
            </thead>
            <tbody>
              <tr className="hover:bg-slate-50/60">
                <td className={clsx(tdCls, 'text-slate-400 text-center')}>1</td>
                <td className={tdCls}>Stock Inicial (SI)</td>
                <td className={tdCls}><code className="bg-slate-100 px-1 rounded text-[10px]">6200</code> Materia Prima</td>
                <td className={tdCls}><span className="text-slate-700">Debe</span></td>
              </tr>
              <tr className="hover:bg-slate-50/60">
                <td className={clsx(tdCls, 'text-slate-400 text-center')}>2</td>
                <td className={tdCls}>Stock Final (SF)</td>
                <td className={tdCls}><code className="bg-slate-100 px-1 rounded text-[10px]">6200</code> Materia Prima</td>
                <td className={tdCls}><span className="text-slate-700">Haber</span></td>
              </tr>
              <tr className="hover:bg-slate-50/60">
                <td className={clsx(tdCls, 'text-slate-400 text-center')}>3</td>
                <td className={tdCls}>Ajuste tenencia (contra-asiento)</td>
                <td className={tdCls}><code className="bg-slate-100 px-1 rounded text-[10px]">6200</code> Materia Prima</td>
                <td className={tdCls}><span className="text-slate-700">Depende del caso</span></td>
              </tr>
              <tr className="hover:bg-slate-50/60">
                <td className={clsx(tdCls, 'text-slate-400 text-center')}>4</td>
                <td className={tdCls}>Resultado por tenencia de inventario</td>
                <td className={tdCls}>
                  <code className="bg-slate-100 px-1 rounded text-[10px]">7900</code> Resultados financieros{' '}
                  <span className="text-emerald-600 text-[10px]">(ganancia → RP)</span>
                  <br />
                  <code className="bg-slate-100 px-1 rounded text-[10px]">6900</code> Resultados financieros{' '}
                  <span className="text-red-600 text-[10px]">(pérdida → RN)</span>
                </td>
                <td className={tdCls}><span className="text-slate-700">Haber / Debe</span></td>
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-slate-400 mt-2">
            Estos movimientos tienen <code className="bg-slate-100 px-1 rounded">sourceType: "cmv-calc"</code>{' '}
            y se vinculan al mismo batch de ingesta. Se integran transparentemente en el P&L bajo
            el subrubro <strong>Materia Prima</strong>.
          </p>
        </div>
      </Section>

      {/* ── 6. Movimientos manuales ───────────────────────────────────── */}
      <Section title="6. Movimientos manuales" badge="Estático" badgeColor="slate">
        <p className="text-xs text-slate-500 mb-3">
          Para gastos que no aparecen en el mayor contable (IIBB, sueldos, honorarios de
          directores, etc.) se pueden cargar manualmente desde la pantalla{' '}
          <strong>Mov. manuales</strong>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="bg-slate-50 border border-slate-200 rounded-md px-4 py-3 space-y-1.5">
            <p className="font-semibold text-slate-700">Persistencia</p>
            <p className="text-slate-500">
              Tienen <code className="bg-slate-100 px-1 rounded">ingestionBatchId: null</code> y
              sobreviven cualquier re-ingesta del período (incluso con{' '}
              <em>force=true</em>).
            </p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-md px-4 py-3 space-y-1.5">
            <p className="font-semibold text-slate-700">Validaciones</p>
            <p className="text-slate-500">
              El rubro no puede ser <em>Cuentas puentes</em>. La fecha debe estar dentro del
              período seleccionado. El sourceType se fija en{' '}
              <code className="bg-slate-100 px-1 rounded">"manual"</code>.
            </p>
          </div>
        </div>
      </Section>
      </div>
    </div>
  );
}
