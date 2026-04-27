import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  FileText,
  Calculator,
  PenSquare,
  ListChecks,
  Settings,
  TrendingUp,
} from 'lucide-react';
import clsx from 'clsx';
import { CurrencyToggle } from '../CurrencyToggle';

const sections: {
  label: string;
  items: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean }[];
}[] = [
  {
    label: 'Análisis',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/resultados', label: 'Estado de resultados', icon: FileText },
      { to: '/cmv', label: 'CMV', icon: Calculator },
      { to: '/movimientos', label: 'Movimientos', icon: ListChecks },
    ],
  },
  {
    label: 'Datos',
    items: [
      { to: '/ingesta', label: 'Ingesta', icon: Upload },
      { to: '/movimientos-manuales', label: 'Mov. manuales', icon: PenSquare },
      { to: '/cotizaciones', label: 'Cotizaciones', icon: TrendingUp },
      { to: '/reglas', label: 'Reglas', icon: Settings },
    ],
  },
];

export function Layout() {
  return (
    <div
      className="flex h-screen"
      style={{ background: 'var(--bg-canvas)' }}
    >
      <aside
        className="flex flex-col gap-4 px-3.5 py-5 flex-shrink-0 h-screen overflow-y-auto"
        style={{
          width: 240,
          background: 'var(--bg-canvas)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center gap-2.5 px-2 pb-3.5"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="sb-brand-mark">S</div>
          <div className="min-w-0">
            <div className="sb-brand-name">Superbol</div>
            <div className="sb-brand-sub">Análisis financiero</div>
          </div>
        </div>

        {/* Nav sections */}
        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-px">
            <div className="sb-group-label">{section.label}</div>
            {section.items.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => clsx('sb-item', isActive && 'active')}
              >
                <Icon size={14} className="opacity-85 flex-shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
          </div>
        ))}

        {/* Footer */}
        <div
          className="mt-auto pt-3 px-1 flex flex-col gap-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <CurrencyToggle />
          <p className="text-[10px] text-center" style={{ color: 'var(--fg-quaternary)' }}>
            v0.1.0
          </p>
        </div>
      </aside>

      <main className="flex-1 overflow-auto" style={{ background: 'var(--bg-canvas)' }}>
        <Outlet />
      </main>
    </div>
  );
}
