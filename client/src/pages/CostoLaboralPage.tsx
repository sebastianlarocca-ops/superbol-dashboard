import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { api } from '../lib/axios';
import { fmtMoney, fmtMoneyCompact, fmtPeriodo } from '../lib/format';

// ── Types ─────────────────────────────────────────────────────────────────────

type PayrollRecord = {
  _id: string;
  nomina: string;
  empresa: string;
  categoriaRecibo: string | null;
  sector: string;
  subSector: string | null;
  ctaDos: number;
  sueldoSinAntig: number;
  antiguedad: number;
  cargasSociales: number;
  aportesPersonales: number;
  totalPorPosicion: number;
  totalSueldoMasCargas: number;
  anosAntiguedad: number | null;
  fechaIngreso: string | null;
  esBaja: boolean;
};

type RecordsResponse = {
  count: number;
  totalCost: number;
  records: PayrollRecord[];
};

type PayrollBatch = {
  _id: string;
  periodo: string;
  stats: { recordCount: number; totalCost: number };
};

type SectorSummary = {
  sector: string;
  activos: number;
  bajas: number;
  sueldoBase: number;
  antiguedad: number;
  cargasSociales: number;
  ctaDos: number;
  total: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

// ── CostoLaboralPage ──────────────────────────────────────────────────────────

export function CostoLaboralPage() {
  const [periodo, setPeriodo] = useState<string | null>(null);
  const [expandedSector, setExpandedSector] = useState<string | null>(null);

  // Period list from payroll batches
  const { data: batchesData, isLoading: batchesLoading } = useQuery({
    queryKey: ['nomina-batches'],
    queryFn: async () =>
      (await api.get<{ count: number; batches: PayrollBatch[] }>('/nomina')).data,
    staleTime: 30_000,
    select: (d) => d.batches,
  });

  // Auto-select most recent period
  if (batchesData && batchesData.length > 0 && !periodo) {
    queueMicrotask(() => setPeriodo(batchesData[0].periodo));
  }

  // Records for selected period
  const { data, isLoading, error } = useQuery({
    queryKey: ['nomina-records', periodo],
    queryFn: async () =>
      (await api.get<RecordsResponse>(`/nomina/records?periodo=${periodo}`)).data,
    enabled: !!periodo,
    staleTime: 30_000,
  });

  // Aggregate by sector
  const sectorSummaries = useMemo<SectorSummary[]>(() => {
    if (!data) return [];
    const map = new Map<string, SectorSummary>();
    for (const r of data.records) {
      const s = map.get(r.sector) ?? {
        sector: r.sector,
        activos: 0,
        bajas: 0,
        sueldoBase: 0,
        antiguedad: 0,
        cargasSociales: 0,
        ctaDos: 0,
        total: 0,
      };
      if (r.esBaja) {
        s.bajas += 1;
      } else {
        s.activos += 1;
        s.sueldoBase += r.sueldoSinAntig;
        s.antiguedad += r.antiguedad;
        s.cargasSociales += r.cargasSociales;
        s.ctaDos += r.ctaDos;
        s.total += r.totalSueldoMasCargas;
      }
      map.set(r.sector, s);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [data]);

  const grandTotal = sectorSummaries.reduce((s, r) => s + r.total, 0);

  const recordsBySector = useMemo(() => {
    if (!data) return new Map<string, PayrollRecord[]>();
    const map = new Map<string, PayrollRecord[]>();
    for (const r of data.records) {
      const arr = map.get(r.sector) ?? [];
      arr.push(r);
      map.set(r.sector, arr);
    }
    return map;
  }, [data]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="ds-fade-in" style={{ padding: '28px 36px 80px', maxWidth: 1280, margin: '0 auto' }}>
      <header className="ds-page-header">
        <div>
          <h1 className="ds-page-title">Costo Laboral</h1>
          <p className="ds-page-subtitle">
            Nómina por sector — sueldos, cargas sociales y costo total para el período.
          </p>
        </div>

        {/* Period selector from payroll batches */}
        {batchesLoading ? (
          <span className="ds-chip">
            <Loader2 size={12} className="animate-spin" /> cargando…
          </span>
        ) : batchesData && batchesData.length > 0 ? (
          <select
            value={periodo ?? ''}
            onChange={(e) => setPeriodo(e.target.value)}
            className="ds-btn ds-btn-ghost text-sm border border-slate-200 rounded-md px-3 py-1.5"
          >
            {batchesData.map((b) => (
              <option key={b._id} value={b.periodo}>
                {fmtPeriodo(b.periodo)}
              </option>
            ))}
          </select>
        ) : (
          <span className="ds-chip">Sin nóminas — andá a Ingesta de Nómina</span>
        )}
      </header>

      {!periodo && !batchesLoading && (
        <div
          className="rounded-lg p-12 text-center text-sm"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--fg-tertiary)' }}
        >
          No hay nóminas cargadas. Subí el archivo desde{' '}
          <a href="/nomina-ingesta" className="underline">Ingesta de Nómina</a>.
        </div>
      )}

      {periodo && isLoading && (
        <div
          className="rounded-lg p-12 flex items-center justify-center gap-2 text-sm"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--fg-tertiary)' }}
        >
          <Loader2 size={16} className="animate-spin" /> Cargando…
        </div>
      )}

      {periodo && error && (
        <div className="bg-red-50 border border-red-300 rounded-md p-4 text-sm text-red-700 flex gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          Error al cargar los datos de nómina.
        </div>
      )}

      {periodo && data && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <KpiCard
              label="Empleados activos"
              value={sectorSummaries.reduce((s, r) => s + r.activos, 0).toString()}
              sub={`${sectorSummaries.reduce((s, r) => s + r.bajas, 0)} en baja`}
            />
            <KpiCard
              label="Sectores"
              value={sectorSummaries.length.toString()}
            />
            <KpiCard
              label="Costo total nómina"
              value={`$ ${fmtMoneyCompact(grandTotal)}`}
              highlight
              sub={`$ ${fmtMoney(grandTotal)}`}
            />
          </div>

          {/* Sector summary table with expandable rows */}
          <div
            className="rounded-lg overflow-hidden mb-6"
            style={{ border: '1px solid var(--border-subtle)' }}
          >
            <div
              className="px-4 py-3 text-xs font-semibold uppercase tracking-wide"
              style={{ background: 'var(--bg-surface-2)', color: 'var(--fg-secondary)', borderBottom: '1px solid var(--border-subtle)' }}
            >
              Por sector
            </div>
            <table className="w-full text-sm">
              <thead style={{ background: 'var(--bg-surface-2)', borderBottom: '1px solid var(--border-subtle)' }}>
                <tr className="text-left text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--fg-tertiary)' }}>
                  <th className="px-4 py-2.5 w-8" />
                  <th className="px-4 py-2.5">Sector</th>
                  <th className="px-4 py-2.5 text-right">Empleados</th>
                  <th className="px-4 py-2.5 text-right">Sueldo base</th>
                  <th className="px-4 py-2.5 text-right">Antigüedad</th>
                  <th className="px-4 py-2.5 text-right">Cargas soc.</th>
                  <th className="px-4 py-2.5 text-right">CTA 2</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5 text-right">% del total</th>
                </tr>
              </thead>
              <tbody>
                {sectorSummaries.map((s) => {
                  const isExpanded = expandedSector === s.sector;
                  const pct = grandTotal > 0 ? (s.total / grandTotal) * 100 : 0;
                  const sectorRecords = recordsBySector.get(s.sector) ?? [];

                  return (
                    <>
                      <tr
                        key={s.sector}
                        className="cursor-pointer"
                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                        onClick={() => setExpandedSector(isExpanded ? null : s.sector)}
                      >
                        <td className="px-4 py-3" style={{ color: 'var(--fg-tertiary)' }}>
                          {isExpanded
                            ? <ChevronDown size={13} />
                            : <ChevronRight size={13} />}
                        </td>
                        <td className="px-4 py-3 font-medium" style={{ color: 'var(--fg-primary)' }}>
                          {s.sector}
                          {s.bajas > 0 && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-700 font-medium">
                              {s.bajas} baja{s.bajas !== 1 ? 's' : ''}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--fg-secondary)' }}>
                          {s.activos}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs" style={{ color: 'var(--fg-secondary)' }}>
                          $ {fmtMoneyCompact(s.sueldoBase)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs" style={{ color: 'var(--fg-secondary)' }}>
                          $ {fmtMoneyCompact(s.antiguedad)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs" style={{ color: 'var(--fg-secondary)' }}>
                          $ {fmtMoneyCompact(s.cargasSociales)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-xs" style={{ color: 'var(--fg-secondary)' }}>
                          $ {fmtMoneyCompact(s.ctaDos)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold" style={{ color: 'var(--fg-primary)' }}>
                          $ {fmtMoneyCompact(s.total)}
                        </td>
                        <td className="px-4 py-3 text-right" style={{ color: 'var(--fg-tertiary)' }}>
                          <div className="flex items-center justify-end gap-2">
                            <div
                              className="h-1.5 rounded-full"
                              style={{
                                width: 60,
                                background: 'var(--border-subtle)',
                              }}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.min(pct, 100)}%`,
                                  background: 'var(--neutral)',
                                }}
                              />
                            </div>
                            <span className="tabular-nums text-xs w-10 text-right">
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded employee rows */}
                      {isExpanded && sectorRecords.map((r) => (
                        <tr
                          key={r._id}
                          style={{
                            borderTop: '1px solid var(--border-subtle)',
                            background: 'var(--bg-surface)',
                          }}
                        >
                          <td className="px-4 py-2" />
                          <td className="px-4 py-2" style={{ paddingLeft: 32 }}>
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs" style={{ color: 'var(--fg-primary)' }}>
                                {r.nomina}
                              </span>
                              {r.esBaja && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-red-50 text-red-700">
                                  baja
                                </span>
                              )}
                              {r.categoriaRecibo && (
                                <span className="text-[10px]" style={{ color: 'var(--fg-quaternary)' }}>
                                  {r.categoriaRecibo}
                                </span>
                              )}
                              {r.subSector && r.subSector !== r.sector && (
                                <span className="text-[10px]" style={{ color: 'var(--fg-quaternary)' }}>
                                  · {r.subSector}
                                </span>
                              )}
                            </div>
                            {r.fechaIngreso && (
                              <div className="text-[10px] mt-0.5" style={{ color: 'var(--fg-quaternary)' }}>
                                Ingreso: {fmtDate(r.fechaIngreso)}
                                {r.anosAntiguedad != null && ` · ${r.anosAntiguedad} años`}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 text-right text-[10px]" style={{ color: 'var(--fg-quaternary)' }}>—</td>
                          <td className="px-4 py-2 text-right tabular-nums text-xs" style={{ color: 'var(--fg-secondary)' }}>
                            {r.esBaja ? '—' : `$ ${fmtMoneyCompact(r.sueldoSinAntig)}`}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-xs" style={{ color: 'var(--fg-secondary)' }}>
                            {r.esBaja ? '—' : `$ ${fmtMoneyCompact(r.antiguedad)}`}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-xs" style={{ color: 'var(--fg-secondary)' }}>
                            {r.esBaja ? '—' : `$ ${fmtMoneyCompact(r.cargasSociales)}`}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-xs" style={{ color: 'var(--fg-secondary)' }}>
                            {r.esBaja ? '—' : `$ ${fmtMoneyCompact(r.ctaDos)}`}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-xs font-medium" style={{ color: r.esBaja ? 'var(--fg-quaternary)' : 'var(--fg-primary)' }}>
                            {r.esBaja ? '—' : `$ ${fmtMoneyCompact(r.totalSueldoMasCargas)}`}
                          </td>
                          <td className="px-4 py-2" />
                        </tr>
                      ))}
                    </>
                  );
                })}

                {/* Grand total row */}
                <tr
                  style={{
                    borderTop: '2px solid var(--border)',
                    background: 'var(--bg-surface-2)',
                  }}
                >
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--fg-secondary)' }}>
                    Total
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: 'var(--fg-secondary)' }}>
                    {sectorSummaries.reduce((s, r) => s + r.activos, 0)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs font-medium" style={{ color: 'var(--fg-secondary)' }}>
                    $ {fmtMoneyCompact(sectorSummaries.reduce((s, r) => s + r.sueldoBase, 0))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs font-medium" style={{ color: 'var(--fg-secondary)' }}>
                    $ {fmtMoneyCompact(sectorSummaries.reduce((s, r) => s + r.antiguedad, 0))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs font-medium" style={{ color: 'var(--fg-secondary)' }}>
                    $ {fmtMoneyCompact(sectorSummaries.reduce((s, r) => s + r.cargasSociales, 0))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-xs font-medium" style={{ color: 'var(--fg-secondary)' }}>
                    $ {fmtMoneyCompact(sectorSummaries.reduce((s, r) => s + r.ctaDos, 0))}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold" style={{ color: 'var(--fg-primary)' }}>
                    $ {fmtMoneyCompact(grandTotal)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{
        background: highlight ? 'var(--neutral-subtle, oklch(0.62 0.19 260 / 0.08))' : 'var(--bg-surface)',
        border: `1px solid ${highlight ? 'var(--neutral, oklch(0.62 0.19 260 / 0.25))' : 'var(--border-subtle)'}`,
      }}
    >
      <p className="text-xs mb-1" style={{ color: 'var(--fg-tertiary)' }}>{label}</p>
      <p
        className="text-2xl font-bold tabular-nums"
        style={{ color: highlight ? 'var(--neutral)' : 'var(--fg-primary)' }}
      >
        {value}
      </p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--fg-quaternary)' }}>{sub}</p>}
    </div>
  );
}
