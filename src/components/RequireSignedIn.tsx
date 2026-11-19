import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../auth';
import type { NavState } from '../navigation';

/**
 * Renders `children` for any signed-in user (admin or staff). Signed-out users are sent to the
 * sign-in page and brought back afterwards. The API enforces the same rule (`requireSignedIn`).
 */
export function RequireSignedIn({ children }: { children: ReactNode }) {
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

  return children;
}
