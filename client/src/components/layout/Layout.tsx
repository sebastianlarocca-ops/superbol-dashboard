import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CurrencyProvider } from '../../context/CurrencyContext';
import {
  LayoutDashboard,
  Upload,
  FileText,
  Calculator,
  PenSquare,
  ListChecks,
  Settings,
  TrendingUp,
  Users,
  LogOut,
} from 'lucide-react';
import clsx from 'clsx';
import { CurrencyToggle } from '../CurrencyToggle';
import { useAuth } from '../../context/AuthContext';

const allSections: {
  label: string;
  adminOnly?: boolean;
  items: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; adminOnly?: boolean }[];
}[] = [
  {
    label: 'Análisis',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/resultados', label: 'Estado de resultados', icon: FileText },
      { to: '/cmv', label: 'CMV', icon: Calculator },
      { to: '/costo-laboral', label: 'Costo Laboral', icon: Users },
      { to: '/movimientos', label: 'Movimientos', icon: ListChecks },
    ],
  },
  {
    label: 'Datos',
    items: [
      { to: '/ingesta', label: 'Ingesta', icon: Upload, adminOnly: true },
      { to: '/nomina-ingesta', label: 'Ingesta Nómina', icon: Users, adminOnly: true },
      { to: '/movimientos-manuales', label: 'Mov. manuales', icon: PenSquare, adminOnly: true },
      { to: '/cotizaciones', label: 'Cotizaciones', icon: TrendingUp, adminOnly: true },
      { to: '/reglas', label: 'Reglas', icon: Settings },
    ],
  },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <CurrencyProvider>
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
        {allSections.map((section) => {
          const visibleItems = section.items.filter((i) => !i.adminOnly || isAdmin);
          if (visibleItems.length === 0) return null;
          return (
            <div key={section.label} className="flex flex-col gap-px">
              <div className="sb-group-label">{section.label}</div>
              {visibleItems.map(({ to, label, icon: Icon, end }) => (
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
          );
        })}

        {/* Footer */}
        <div
          className="mt-auto pt-3 px-1 flex flex-col gap-3"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <CurrencyToggle />

          {/* User + logout */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px]" style={{ color: 'var(--fg-tertiary)' }}>
              {user?.username}
            </span>
            <button
              onClick={handleLogout}
              title="Cerrar sesión"
              className="flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 transition-colors"
              style={{ color: 'var(--fg-quaternary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fg-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--fg-quaternary)')}
            >
              <LogOut size={12} />
            </button>
          </div>

          <p className="text-[10px] text-center" style={{ color: 'var(--fg-quaternary)' }}>
            v0.1.0
          </p>
        </div>
      </aside>

      <main className="flex-1 overflow-auto" style={{ background: 'var(--bg-canvas)' }}>
        <Outlet />
      </main>
    </div>
    </CurrencyProvider>
  );
}
