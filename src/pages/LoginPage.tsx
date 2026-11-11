import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../api';
import { useAuth } from '../auth';
import { safePath, type NavState } from '../navigation';

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const state = useLocation().state as NavState | null;
  const returnTo = safePath(state?.returnTo);
  const from = state?.from;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = 'Sign in | Vehicle Inventory';
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await auth.login(username, password);
      const notice =
        user.role === 'admin'
          ? `Signed in as ${user.username}. You can add, edit and delete vehicles.`
          : `Signed in as ${user.username}. Your account can view vehicles only.`;
      navigate(returnTo === '/login' ? '/' : returnTo, { replace: true, state: { from, notice } satisfies NavState });
    } catch (err) {
      setBusy(false);
      setPassword('');
      if (err instanceof ApiError && (err.status === 401 || err.status === 429 || err.status === 400)) setError(err.message);
      else setError("Couldn't reach the server. Check that the API server and database are running.");
    }
  };

  if (auth.user) {
    return (
      <div className="login">
        <div className="login-card">
          <h1>You're signed in</h1>
          <p className="login-sub">
            Signed in as <strong>{auth.user.username}</strong> ({auth.user.role === 'admin' ? 'admin' : 'staff, view only'}).
          </p>
          <div className="form-actions">
            <Link to={returnTo === '/login' ? '/' : returnTo} state={{ from }} className="button">Continue</Link>
            <button type="button" className="button button-secondary" onClick={() => void auth.logout()}>
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <span className="logo" aria-hidden>◆</span>
        <h1>Sign in</h1>
        <p className="login-sub">Admins sign in to add, edit or delete vehicles. Anyone can browse the inventory without signing in.</p>

        {error && <div className="alert-error" role="alert">{error}</div>}

        <fieldset disabled={busy}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={50}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Link to="/forgot-password" className="forgot-link">Forgot password?</Link>
          </div>
        </fieldset>

        <div className="form-actions">
          <button type="submit" className="button login-submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
        <p className="login-back">
          <Link to={safePath(from)}>← Back to inventory</Link>
        </p>
      </form>
    </div>
  );
}
