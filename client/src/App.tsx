import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { RequireAuth, RequireAdmin } from './components/auth/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { IngestaPage } from './pages/IngestaPage';
import { ResultadosPage } from './pages/ResultadosPage';
import { CMVPage } from './pages/CMVPage';
import { MovimientosManualesPage } from './pages/MovimientosManualesPage';
import { CotizacionesPage } from './pages/CotizacionesPage';
import { MovimientosPage } from './pages/MovimientosPage';
import { ReglasPage } from './pages/ReglasPage';
import { NominaIngestaPage } from './pages/NominaIngestaPage';
import { CostoLaboralPage } from './pages/CostoLaboralPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          {/* Any authenticated user */}
          <Route path="/" element={<DashboardPage />} />
          <Route path="/resultados" element={<ResultadosPage />} />
          <Route path="/cmv" element={<CMVPage />} />
          <Route path="/costo-laboral" element={<CostoLaboralPage />} />
          <Route path="/movimientos" element={<MovimientosPage />} />
          <Route path="/reglas" element={<ReglasPage />} />

          {/* Admin only */}
          <Route element={<RequireAdmin />}>
            <Route path="/ingesta" element={<IngestaPage />} />
            <Route path="/nomina-ingesta" element={<NominaIngestaPage />} />
            <Route path="/movimientos-manuales" element={<MovimientosManualesPage />} />
            <Route path="/cotizaciones" element={<CotizacionesPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
