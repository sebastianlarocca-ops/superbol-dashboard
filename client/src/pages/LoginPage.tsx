import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch {
      setError('Usuario o contraseña incorrectos');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex h-screen items-center justify-center"
      style={{ background: 'var(--bg-canvas)' }}
    >
      <div
        className="w-full max-w-sm rounded-xl p-8 flex flex-col gap-6"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      >
        {/* Brand */}
        <div className="flex flex-col items-center gap-2">
          <div className="sb-brand-mark text-xl">S</div>
          <div className="sb-brand-name text-lg">Superbol</div>
          <div className="sb-brand-sub">Análisis financiero</div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="username"
              className="text-xs font-medium"
              style={{ color: 'var(--fg-secondary)' }}
            >
              Usuario
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="sb-input w-full"
              style={{ background: 'var(--bg-canvas)', color: 'var(--fg-primary)' }}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-xs font-medium"
              style={{ color: 'var(--fg-secondary)' }}
            >
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="sb-input w-full"
              style={{ background: 'var(--bg-canvas)', color: 'var(--fg-primary)' }}
              required
            />
          </div>

          {error && (
            <p className="text-xs text-center" style={{ color: 'var(--color-red)' }}>
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="sb-btn-primary w-full mt-1"
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
