import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/axios';

type Health = { status: string; db: string; uptime: number; timestamp: string };

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health'],
    queryFn: async () => (await api.get<Health>('/health')).data,
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-slate-900">Dashboard</h2>
        <p className="text-sm text-slate-500 mt-1">
          Próximamente: KPIs mensuales, evolución de resultados, top gastos por subrubro.
        </p>
      </header>

      <section className="bg-white rounded-lg border border-slate-200 p-6">
        <h3 className="text-sm font-medium text-slate-700 mb-3">Estado del backend</h3>
        {isLoading && <p className="text-sm text-slate-500">Conectando…</p>}
        {error && (
          <p className="text-sm text-red-600">
            No se pudo conectar al backend. Asegurate de que esté corriendo en :5001.
          </p>
        )}
        {data && (
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-slate-500">Status</dt>
              <dd className="font-medium text-slate-900">{data.status}</dd>
            </div>
            <div>
              <dt className="text-slate-500">MongoDB</dt>
              <dd className="font-medium text-slate-900">{data.db}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Uptime</dt>
              <dd className="font-medium text-slate-900">{Math.round(data.uptime)}s</dd>
            </div>
            <div>
              <dt className="text-slate-500">Timestamp</dt>
              <dd className="font-medium text-slate-900">{data.timestamp}</dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
