import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { fetchLeadCounts, fetchPendingSaleCount, fetchResetRequests, useRemote } from '../api';
import { useAuth } from '../auth';
import type { NavState } from '../navigation';
import type { Role } from '../types';

const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', manager: 'Sales manager', sales: 'Sales rep', staff: 'View only' };

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
  // Leads needing attention: overdue follow-ups, plus (for managers) leads waiting to be assigned.
  const leadCounts = useRemote(auth.isSalesTeam ? `lead-counts-${location.pathname}` : null, (signal) => fetchLeadCounts(signal));
  const overdue = leadCounts.status === 'ready' ? leadCounts.data.overdue : 0;
  const unassigned = leadCounts.status === 'ready' && auth.isLeadManager ? leadCounts.data.unassigned : 0;
  const leadAttention = overdue + unassigned;
  const leadBadgeText = [
    overdue > 0 && `${overdue} overdue follow-up${overdue === 1 ? '' : 's'}`,
    unassigned > 0 && `${unassigned} unassigned lead${unassigned === 1 ? '' : 's'}`,
  ]
    .filter(Boolean)
    .join(', ');
  // Sales waiting for this manager's/admin's approval.
  const approvals = useRemote(auth.isLeadManager ? `sale-approvals-${location.pathname}` : null, (signal) => fetchPendingSaleCount(signal));
  const toApprove = approvals.status === 'ready' ? approvals.data : 0;

  // Phones (≤640px): the signed-in links collapse into a "Menu" dropdown.
  // Open only on the page where it was opened, so navigating closes it.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === location.key;
  const toggleMenu = () => setMenuOpenOn((current) => (current === location.key ? null : location.key));
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpenOn(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpenOn(null);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  if (PUBLIC_AUTH_PAGES.includes(location.pathname) || auth.status === 'loading') return <div className="account-bar" />;

  const contactLink = location.pathname !== '/contact' && !location.pathname.startsWith('/leads') && (
    <Link
      to="/contact"
      state={{ from: location.pathname.startsWith('/vehicles/') ? state?.from : location.pathname + location.search } satisfies NavState}
      className="account-link"
    >
      Contact us
    </Link>
  );

  if (!auth.user) {
    return (
      <div className="account-bar">
        {contactLink}
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

  const attention = leadAttention + toApprove + (auth.isAdmin ? pending : 0);

  return (
    <div className="account-bar" ref={menuRef}>
      <span className="account-user">
        {auth.user.username}
        <span className={auth.isAdmin ? 'pill role-admin' : 'pill pill-neutral'}>{ROLE_LABELS[auth.user.role]}</span>
      </span>
      <button
        type="button"
        className="account-menu-toggle"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onClick={toggleMenu}
      >
        Menu
        {attention > 0 && !menuOpen && (
          <span className="badge" aria-hidden="true">{attention}</span>
        )}
      </button>
      <div id={menuId} className={menuOpen ? 'account-links open' : 'account-links'}>
      {contactLink}
      {auth.isSalesTeam && location.pathname !== '/leads' && (
        <Link to="/leads" className="account-link">
          Leads
          {leadAttention > 0 && (
            <span className="badge" title={leadBadgeText}>
              {leadAttention}
              <span className="visually-hidden"> ({leadBadgeText})</span>
            </span>
          )}
        </Link>
      )}
      {auth.isSalesTeam && location.pathname !== '/sales' && (
        <Link to={toApprove > 0 ? '/sales?tab=decide' : '/sales'} className="account-link">
          Sales
          {toApprove > 0 && (
            <span className="badge" title={`${toApprove} sale${toApprove === 1 ? '' : 's'} to approve`}>
              {toApprove}
              <span className="visually-hidden"> sale{toApprove === 1 ? '' : 's'} to approve</span>
            </span>
          )}
        </Link>
      )}
      {auth.isSalesTeam && location.pathname !== '/earnings' && (
        <Link to="/earnings" className="account-link">Earnings</Link>
      )}
      {auth.isAdmin && location.pathname !== '/admin/compensation' && (
        <Link to="/admin/compensation" className="account-link">Compensation</Link>
      )}
      {location.pathname !== '/dashboard' && (
        <Link to="/dashboard" className="account-link">
          Dashboard
        </Link>
      )}
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
    </div>
  );
}
