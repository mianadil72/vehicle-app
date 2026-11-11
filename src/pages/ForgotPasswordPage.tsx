import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiError, requestPasswordReset } from '../api';

/** `/forgot-password`: asks an admin for a reset link. There's no email; the admin passes the link on. */
export function ForgotPasswordPage() {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = 'Forgot password | Vehicle Inventory';
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Enter your username.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(username.trim());
      setSent(true);
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 400 || err.status === 429)
          ? err.message
          : "Couldn't reach the server. Check that the API server and database are running.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="login">
        <div className="login-card">
          <span className="logo" aria-hidden>◆</span>
          <h1>Request sent</h1>
          <p className="login-sub">
            If <strong>{username.trim()}</strong> is an active account, the admins can now see your request. Ask an
            admin for your <strong>reset link</strong>. It works once, for 24 hours, and lets you choose a new password.
          </p>
          <p className="login-sub">No email is sent, so contact an admin directly if you need it sooner.</p>
          <div className="form-actions">
            <Link to="/login" className="button login-submit">Back to sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit} noValidate>
        <span className="logo" aria-hidden>◆</span>
        <h1>Forgot password</h1>
        <p className="login-sub">
          Enter your username and we'll ask an admin to reset your password. They'll give you a one-time link to
          choose a new one.
        </p>
        {error && <div className="alert-error" role="alert">{error}</div>}
        <fieldset disabled={busy}>
          <div className="field">
            <label htmlFor="forgot-username">Username</label>
            <input
              id="forgot-username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={50}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>
        </fieldset>
        <div className="form-actions">
          <button type="submit" className="button login-submit" disabled={busy}>
            {busy ? 'Sending…' : 'Ask an admin to reset it'}
          </button>
        </div>
        <p className="login-back">
          <Link to="/login">← Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
