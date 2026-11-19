import type { ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth, type Auth } from '../auth';
import { safePath, type NavState } from '../navigation';

/**
 * Renders `children` only when `allowed(auth)` is true. Signed-out users are sent to the sign-in page
 * (and brought back afterwards); other signed-in users see `deniedTitle`/`deniedText`. The API enforces
 * the same rule; this only keeps the UI tidy.
 */
export function RequireRole(props: {
  allowed: (auth: Auth) => boolean;
  deniedTitle: string;
  deniedText: string;
  children: ReactNode;
}) {
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

  if (!props.allowed(auth)) {
    return (
      <div className="empty detail-missing">
        <h2>{props.deniedTitle}</h2>
        <p>{props.deniedText}</p>
        <Link to={safePath(state?.from)} className="button">Back to inventory</Link>
      </div>
    );
  }

  return props.children;
}

/** For the Leads pages: admins, managers and sales reps. */
export function RequireSalesTeam({ children }: { children: ReactNode }) {
  return (
    <RequireRole
      allowed={(a) => a.isSalesTeam}
      deniedTitle="Sales team only"
      deniedText="Customer leads are only available to sales reps, sales managers and admins."
    >
      {children}
    </RequireRole>
  );
}
