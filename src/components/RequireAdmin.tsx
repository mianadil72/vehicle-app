import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import { safePath, type NavState } from '../navigation';

/**
 * Renders `children` only for signed-in admins. Signed-out users are sent to the sign-in page (and
 * brought back afterwards); staff accounts see an explanation. The API enforces the same rule.
 */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const state = location.state as NavState | null;

  if (auth.status === 'loading') {
    return (
      <div className="empty" role="status">
        <p>Checking sign-in…</p>
      </div>
    );
  }

  if (!auth.user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ returnTo: location.pathname + location.search, from: state?.from } satisfies NavState}
      />
    );
  }

  if (!auth.isAdmin) {
    return (
      <div className="empty detail-missing">
        <h2>Admins only</h2>
        <p>Your account ({auth.user.username}) can view vehicles but can't add, edit or delete them.</p>
        <Link to={safePath(state?.from)} className="button">Back to inventory</Link>
      </div>
    );
  }

  return children;
}
