import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ApiError, checkResetLink, redeemResetLink, useRemote } from '../api';
import type { NavState } from '../navigation';

const MIN_LENGTH = 10;

/** `/reset-password#<token>`: the one-time link an admin created. Lets the user choose a new password. */
export function ResetPasswordPage() {
  const token = useLocation().hash.slice(1);
  const link = useRemote(token ? `reset-${token}` : null, () => checkResetLink(token));

  useEffect(() => {
    document.title = 'Reset password | Vehicle Inventory';
  }, []);

  // Network trouble gets a retry; a 400 means the link itself is bad.
  const invalid = !token || (link.status === 'error' && link.error instanceof ApiError && link.error.status === 400);

  return (
    <div className="login">
      {invalid ? (
        <div className="login-card">
          <span className="logo" aria-hidden>◆</span>
          <h1>Link not valid</h1>
          <p className="login-sub">
            This reset link is invalid, has expired, or was already used. Links work once, for 24 hours. Ask an admin
            for a new one.
          </p>
          <div className="form-actions">
            <Link to="/forgot-password" className="button">Request a new link</Link>
            <Link to="/login" className="button button-secondary">Sign in</Link>
          </div>
        </div>
      ) : link.status === 'loading' ? (
        <div className="login-card" role="status">
          <p className="login-sub">Checking your reset link…</p>
        </div>
      ) : link.status === 'error' ? (
        <div className="login-card" role="alert">
          <h1>Couldn't check the link</h1>
          <p className="login-sub">Check that the API server and database are running.</p>
          <button type="button" className="button" onClick={link.retry}>Try again</button>
        </div>
      ) : (
        <ResetForm token={token} username={link.data} />
      )}
    </div>
  );
}

function ResetForm({ token, username }: { token: string; username: string }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<'newPassword' | 'confirm', string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const problems: typeof errors =
      password.length < MIN_LENGTH
        ? { newPassword: `Use at least ${MIN_LENGTH} characters` }
        : password.trim() !== password
          ? { newPassword: "Password can't start or end with a space" }
          : confirm !== password
            ? { confirm: "Passwords don't match" }
            : {};
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setBusy(true);
    try {
      await redeemResetLink(token, password);
      // Replace the link in history so Back doesn't return to a used link.
      navigate('/login', {
        replace: true,
        state: { notice: `Password changed for ${username}. Sign in with your new password.` } satisfies NavState,
      });
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.fields.newPassword) setErrors({ newPassword: err.fields.newPassword });
      else if (err instanceof ApiError && err.status === 400) setFormError(err.message);
      else setFormError("Couldn't reach the server. Check that the API server and database are running.");
    }
  };

  return (
    <form className="login-card" onSubmit={onSubmit} noValidate>
      <span className="logo" aria-hidden>◆</span>
      <h1>Choose a new password</h1>
      <p className="login-sub">
        For <strong>{username}</strong>. You'll be signed out everywhere and can then sign in with the new password.
      </p>
      {formError && <div className="alert-error" role="alert">{formError}</div>}
      {/* Lets password managers save the new password under the right username. */}
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
      <fieldset disabled={busy}>
        <div className="field">
          <label htmlFor="reset-new">New password</label>
          <input
            id="reset-new"
            type="password"
            autoComplete="new-password"
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errors.newPassword ? true : undefined}
            aria-describedby={errors.newPassword ? 'reset-new-error' : undefined}
            autoFocus
          />
          {errors.newPassword ? (
            <p className="field-error" id="reset-new-error">{errors.newPassword}</p>
          ) : (
            <p className="field-hint">At least {MIN_LENGTH} characters.</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="reset-confirm">Confirm new password</label>
          <input
            id="reset-confirm"
            type="password"
            autoComplete="new-password"
            maxLength={200}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={errors.confirm ? true : undefined}
            aria-describedby={errors.confirm ? 'reset-confirm-error' : undefined}
          />
          {errors.confirm && <p className="field-error" id="reset-confirm-error">{errors.confirm}</p>}
        </div>
      </fieldset>
      <div className="form-actions">
        <button type="submit" className="button login-submit" disabled={busy}>
          {busy ? 'Saving…' : 'Set new password'}
        </button>
      </div>
    </form>
  );
}
