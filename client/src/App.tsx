import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/layout/Layout';
import { DashboardPage } from './pages/DashboardPage';
import { IngestaPage } from './pages/IngestaPage';
import { ResultadosPage } from './pages/ResultadosPage';
import { CMVPage } from './pages/CMVPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/ingesta" element={<IngestaPage />} />
        <Route path="/resultados" element={<ResultadosPage />} />
        <Route path="/cmv" element={<CMVPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
