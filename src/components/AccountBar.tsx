import { Link, useLocation, useNavigate } from 'react-router';
import { fetchResetRequests, useRemote } from '../api';
import { useAuth } from '../auth';
import type { NavState } from '../navigation';

const PUBLIC_AUTH_PAGES = ['/login', '/forgot-password', '/reset-password'];

/** Top-right account strip: "Admin sign in", or who is signed in with a sign-out button. */
export function AccountBar() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as NavState | null;
  // Re-checked on every page change, so admins notice new "forgot password" requests.
  const requests = useRemote(auth.isAdmin ? `reset-requests-${location.pathname}` : null, (signal) =>
    fetchResetRequests(signal),
  );
  const pending = requests.status === 'ready' ? requests.data.length : 0;

  if (PUBLIC_AUTH_PAGES.includes(location.pathname) || auth.status === 'loading') return <div className="account-bar" />;

  if (!auth.user) {
    return (
      <div className="account-bar">
        <Link
          to="/login"
          state={{ returnTo: location.pathname + location.search, from: state?.from } satisfies NavState}
          className="account-link"
        >
          Admin sign in
        </Link>
      </div>
    );
  }

  const onSignOut = async () => {
    await auth.logout();
    // Stay on the same page; admin-only pages switch to their "sign in" prompt.
    navigate(location, { replace: true, state: { ...state, notice: 'Signed out.' } satisfies NavState });
  };

  return (
    <div className="account-bar">
      <span className="account-user">
        {auth.user.username}
        <span className={auth.isAdmin ? 'pill role-admin' : 'pill pill-neutral'}>
          {auth.isAdmin ? 'Admin' : 'View only'}
        </span>
      </span>
      {auth.isAdmin && location.pathname !== '/account/password' && (
        <Link
          to="/account/password"
          state={{ from: location.pathname.startsWith('/vehicles/') ? state?.from : location.pathname + location.search } satisfies NavState}
          className="account-link"
        >
          Passwords
          {pending > 0 && (
            <span className="badge" title={`${pending} password reset request${pending === 1 ? '' : 's'}`}>
              {pending}
              <span className="visually-hidden"> pending reset request{pending === 1 ? '' : 's'}</span>
            </span>
          )}
        </Link>
      )}
      <button type="button" className="account-link" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
