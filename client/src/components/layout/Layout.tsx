import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  FileText,
  Calculator,
  PenSquare,
  Scale,
  ListChecks,
  Settings,
  TrendingUp,
} from 'lucide-react';
import clsx from 'clsx';
import { CurrencyToggle } from '../CurrencyToggle';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/ingesta', label: 'Ingesta', icon: Upload },
  { to: '/movimientos-manuales', label: 'Mov. manuales', icon: PenSquare },
  { to: '/resultados', label: 'Estado de resultados', icon: FileText },
  { to: '/cmv', label: 'CMV', icon: Calculator },
  { to: '/cotizaciones', label: 'Cotizaciones', icon: TrendingUp },
  { to: '/balance', label: 'Balance', icon: Scale, disabled: true },
  { to: '/movimientos', label: 'Movimientos', icon: ListChecks },
  { to: '/reglas', label: 'Reglas', icon: Settings, disabled: true },
];

export function Layout() {
  return (
    <div className="flex h-full">
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-6 py-5 border-b border-slate-800">
          <h1 className="text-lg font-semibold tracking-tight">Superbol</h1>
          <p className="text-xs text-slate-400">Dashboard contable</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon, disabled }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  disabled && 'opacity-40 pointer-events-none',
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                )
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-800 space-y-2">
          <CurrencyToggle />
          <p className="text-xs text-slate-500 text-center">v0.1.0</p>
        </div>
      </aside>
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
