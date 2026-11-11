import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router';
import {
  ApiError,
  changeOwnPassword,
  createResetLink,
  dismissResetRequest,
  fetchResetRequests,
  fetchUsers,
  resetUserPassword,
  useRemote,
} from '../api';
import { authErrorMessage, useAuth } from '../auth';
import { RemoteStatus } from '../components/RemoteStatus';
import { formatDateTime } from '../format';
import { safePath, type NavState } from '../navigation';

const MIN_LENGTH = 10;

/** Client-side check before sending; the server applies the same rules. */
function newPasswordProblem(password: string, confirm: string): Partial<Record<'newPassword' | 'confirm', string>> {
  if (password.length < MIN_LENGTH) return { newPassword: `Use at least ${MIN_LENGTH} characters` };
  if (password.trim() !== password) return { newPassword: "Password can't start or end with a space" };
  if (confirm !== password) return { confirm: "Passwords don't match" };
  return {};
}

/** `/account/password` (admins only): change your own password, or reset another user's. */
export function PasswordPage() {
  const from = (useLocation().state as NavState | null)?.from;
  // Requests handled on this page (link created, password set, or dismissed), hidden without reloading.
  const [resolved, setResolved] = useState<ReadonlySet<string>>(new Set());
  const markResolved = (userId: string) => setResolved((set) => new Set(set).add(userId));

  useEffect(() => {
    document.title = 'Passwords | Vehicle Inventory';
  }, []);

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={safePath(from)}>← Back to inventory</Link>
      </nav>
      <div className="password-page">
        <ResetRequests resolved={resolved} onResolved={markResolved} />
        <ChangeOwnPassword />
        <ResetUserPassword onResolved={markResolved} />
      </div>
    </>
  );
}

function ChangeOwnPassword() {
  const auth = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(false);
    setFormError(null);
    const problems = { ...(current ? {} : { currentPassword: 'Enter your current password' }), ...newPasswordProblem(password, confirm) };
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    try {
      await changeOwnPassword(current, password);
      setCurrent('');
      setPassword('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      const authProblem = authErrorMessage(err);
      if (authProblem) auth.refresh();
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) setErrors(err.fields);
      else setFormError(authProblem ?? (err instanceof ApiError ? err.message : "Couldn't change the password."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="vehicle-form" onSubmit={onSubmit} noValidate>
      <h1>Change your password</h1>
      <p className="login-sub">
        Signed in as <strong>{auth.user?.username}</strong>. Your other signed-in sessions will be signed out.
      </p>
      {done && <div className="notice" role="status">Your password has been changed.</div>}
      {formError && <div className="alert-error" role="alert">{formError}</div>}
      <fieldset disabled={saving} className="stack">
        <PasswordField id="currentPassword" label="Current password" autoComplete="current-password" value={current} onChange={setCurrent} error={errors.currentPassword} />
        <PasswordField id="newPassword" label="New password" autoComplete="new-password" value={password} onChange={setPassword} error={errors.newPassword} hint={`At least ${MIN_LENGTH} characters.`} />
        <PasswordField id="confirmPassword" label="Confirm new password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={errors.confirm} />
      </fieldset>
      <div className="form-actions">
        <button type="submit" className="button" disabled={saving}>{saving ? 'Saving…' : 'Change password'}</button>
      </div>
    </form>
  );
}

/** "Forgot password" requests from the sign-in page, waiting for an admin. */
function ResetRequests({ resolved, onResolved }: { resolved: ReadonlySet<string>; onResolved: (userId: string) => void }) {
  const auth = useAuth();
  const requests = useRemote('reset-requests', (signal) => fetchResetRequests(signal));
  const open = requests.status === 'ready' ? requests.data.filter((r) => !resolved.has(r.userId)) : [];
  const [link, setLink] = useState<ResetLink | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (userId: string, action: 'link' | 'dismiss') => {
    setBusy(userId);
    setError(null);
    try {
      if (action === 'link') setLink(await createResetLink(userId));
      else await dismissResetRequest(userId);
      onResolved(userId);
    } catch (err) {
      const authProblem = authErrorMessage(err);
      if (authProblem) auth.refresh();
      // 404: already handled by another admin, or the user was deactivated.
      if (err instanceof ApiError && err.status === 404) onResolved(userId);
      else setError(authProblem ?? (err instanceof ApiError ? err.message : "Couldn't complete that."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="vehicle-form password-requests" aria-labelledby="requests-title">
      <h2 id="requests-title">
        Reset requests {requests.status === 'ready' && <span className="count">{open.length}</span>}
      </h2>
      <p className="login-sub">
        People who used "Forgot password?" on the sign-in page. Create a one-time link and pass it to them in
        person or by chat. They choose their own new password, and the link stops working after one use or 24 hours.
      </p>
      {link && <ResetLinkResult link={link} onDone={() => setLink(null)} />}
      {error && <div className="alert-error" role="alert">{error}</div>}
      {requests.status !== 'ready' ? (
        <RemoteStatus remote={requests} what="reset requests" />
      ) : open.length === 0 ? (
        <p className="comments-empty">No open requests.</p>
      ) : (
        <ul className="request-list">
          {open.map((r) => (
            <li key={r.userId} className="request">
              <div>
                <strong>{r.username}</strong> <span className="pill pill-neutral">{r.role}</span>
                <div className="field-hint">
                  Requested <time dateTime={r.requestedAt}>{formatDateTime(r.requestedAt)}</time>
                </div>
              </div>
              <div className="request-actions">
                <button type="button" className="button" disabled={busy !== null} onClick={() => act(r.userId, 'link')}>
                  {busy === r.userId ? 'Working…' : 'Create reset link'}
                </button>
                <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => act(r.userId, 'dismiss')}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type ResetLink = Awaited<ReturnType<typeof createResetLink>>;

/** Shows a newly created reset link once, with a copy button. Only its hash is stored on the server. */
function ResetLinkResult({ link, onDone }: { link: ResetLink; onDone: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="reset-link" role="status">
      <p>
        <strong>Reset link for {link.username}</strong>. Send it to them in person or by chat. It works once and
        expires {formatDateTime(link.expiresAt)}. <strong>It won't be shown again.</strong>
      </p>
      <div className="reset-link-row">
        <input
          readOnly
          value={link.url}
          aria-label={`Reset link for ${link.username}`}
          className="mono"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="button" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        <button type="button" className="button button-secondary" onClick={onDone}>Done</button>
      </div>
      {copied === false && <p className="field-hint">Couldn't copy automatically. Select the link and copy it.</p>}
    </div>
  );
}

function ResetUserPassword({ onResolved }: { onResolved: (userId: string) => void }) {
  const auth = useAuth();
  const users = useRemote('users', (signal) => fetchUsers(signal));
  const others = users.status === 'ready' ? users.data.filter((u) => u.id !== auth.user?.id) : [];

  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState<ResetLink | null>(null);

  const onCreateLink = async () => {
    setDone(null);
    setFormError(null);
    setLink(null);
    if (!userId) {
      setErrors({ userId: 'Choose a user' });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      setLink(await createResetLink(userId));
      onResolved(userId);
    } catch (err) {
      const authProblem = authErrorMessage(err);
      if (authProblem) auth.refresh();
      setFormError(authProblem ?? (err instanceof ApiError ? err.message : "Couldn't create the link."));
    } finally {
      setSaving(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setDone(null);
    setFormError(null);
    setLink(null);
    const problems = { ...(userId ? {} : { userId: 'Choose a user' }), ...newPasswordProblem(password, confirm) };
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    try {
      await resetUserPassword(userId, password);
      onResolved(userId);
      const name = others.find((u) => u.id === userId)?.username ?? 'the user';
      setPassword('');
      setConfirm('');
      setDone(`Password reset for ${name}. They've been signed out and must use the new password. Share it with them securely.`);
    } catch (err) {
      const authProblem = authErrorMessage(err);
      if (authProblem) auth.refresh();
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) setErrors(err.fields);
      else setFormError(authProblem ?? (err instanceof ApiError ? err.message : "Couldn't reset the password."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="vehicle-form" onSubmit={onSubmit} noValidate>
      <h2>Reset a user's password</h2>
      <p className="login-sub">
        For staff or other admins who've forgotten theirs, with or without a request. A reset link (recommended) lets
        them choose their own password. Either way, they're signed out everywhere.
      </p>
      {done && <div className="notice" role="status">{done}</div>}
      {link && <ResetLinkResult link={link} onDone={() => setLink(null)} />}
      {formError && <div className="alert-error" role="alert">{formError}</div>}
      {users.status !== 'ready' ? (
        <RemoteStatus remote={users} what="users" />
      ) : others.length === 0 ? (
        <p className="comments-empty">
          There are no other accounts yet. Create one with <code>npm run user -- &lt;username&gt; --role staff</code>.
        </p>
      ) : (
        <>
          <fieldset disabled={saving} className="stack">
            <div className="field">
              <label htmlFor="resetUser">User</label>
              <select
                id="resetUser"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                aria-invalid={errors.userId ? true : undefined}
                aria-describedby={errors.userId ? 'resetUser-error' : undefined}
              >
                <option value="" disabled>Choose…</option>
                {others.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username} ({u.role}{u.isActive ? '' : ', deactivated'})
                  </option>
                ))}
              </select>
              {errors.userId && <p className="field-error" id="resetUser-error">{errors.userId}</p>}
            </div>
          </fieldset>
          <div className="form-actions">
            <button type="button" className="button" disabled={saving} onClick={onCreateLink}>
              Create reset link
            </button>
          </div>
          <p className="or-divider"><span>or set a password for them</span></p>
          <fieldset disabled={saving} className="stack">
            <PasswordField id="resetPassword" label="New password" autoComplete="new-password" value={password} onChange={setPassword} error={errors.newPassword} hint={`At least ${MIN_LENGTH} characters.`} />
            <PasswordField id="resetConfirm" label="Confirm new password" autoComplete="new-password" value={confirm} onChange={setConfirm} error={errors.confirm} />
          </fieldset>
          <div className="form-actions">
            <button type="submit" className="button button-secondary" disabled={saving}>{saving ? 'Saving…' : 'Set password'}</button>
          </div>
        </>
      )}
    </form>
  );
}

function PasswordField(props: {
  id: string;
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        type="password"
        autoComplete={props.autoComplete}
        maxLength={200}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? `${props.id}-error` : undefined}
      />
      {props.error ? (
        <p className="field-error" id={`${props.id}-error`}>{props.error}</p>
      ) : (
        props.hint && <p className="field-hint">{props.hint}</p>
      )}
    </div>
  );
}
