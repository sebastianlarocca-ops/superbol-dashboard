import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { IngestaPage } from './pages/IngestaPage';
import { ResultadosPage } from './pages/ResultadosPage';
import { CMVPage } from './pages/CMVPage';
import { MovimientosManualesPage } from './pages/MovimientosManualesPage';
import { CotizacionesPage } from './pages/CotizacionesPage';
import { MovimientosPage } from './pages/MovimientosPage';
import { ReglasPage } from './pages/ReglasPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/ingesta" element={<IngestaPage />} />
        <Route path="/movimientos-manuales" element={<MovimientosManualesPage />} />
        <Route path="/resultados" element={<ResultadosPage />} />
        <Route path="/cmv" element={<CMVPage />} />
        <Route path="/movimientos" element={<MovimientosPage />} />
        <Route path="/cotizaciones" element={<CotizacionesPage />} />
        <Route path="/reglas" element={<ReglasPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
