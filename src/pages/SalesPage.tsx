import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { ApiError, approveSale, fetchSales, rejectSale, useRemote, voidSale } from '../api';
import { useAuth } from '../auth';
import { RemoteStatus } from '../components/RemoteStatus';
import { formatDayLong, formatMoney, formatPrice } from '../format';
import { SALE_STATUSES, type Sale, type SaleStatus } from '../types';

type Tab = 'mine' | 'decide' | 'all';

/** `/sales` (sales team): my sales; managers' approval queue; admins see everything and can void. */
export function SalesPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const canDecide = auth.isLeadManager;
  const tab: Tab = params.get('tab') === 'decide' && canDecide ? 'decide' : params.get('tab') === 'all' && canDecide ? 'all' : 'mine';
  const statusParam = params.get('status');
  const status = (SALE_STATUSES as readonly string[]).includes(statusParam ?? '') ? (statusParam as SaleStatus) : undefined;
  // Bumped after a change so the list reloads.
  const [version, setVersion] = useState(0);
  const sales = useRemote(`sales-${tab}-${status ?? ''}-${version}`, (signal) =>
    fetchSales({ view: tab === 'all' ? undefined : tab, status: tab === 'decide' ? undefined : status }, signal),
  );

  useEffect(() => {
    document.title = 'Sales | ONE-STOP VEHICLE SHOP DEALERSHIP';
  }, []);

  const setTab = (t: Tab) => setParams(t === 'mine' ? {} : { tab: t });
  const setStatus = (s: string) => {
    const next = new URLSearchParams(params);
    if (s) next.set('status', s);
    else next.delete('status');
    setParams(next, { replace: true });
  };

  return (
    <div className="leads-page">
      <div className="dashboard-head">
        <div>
          <h1>Sales</h1>
          <p className="dashboard-sub">
            Record each vehicle you sell. {auth.user?.role === 'sales' ? 'Your manager' : 'An admin'} approves it, then the perk is added to your pay.
            {auth.isLeadManager && !auth.isAdmin && ' You approve your reps’ sales under Team approvals.'}
          </p>
        </div>
        <Link to="/sales/new" className="button">+ Record a sale</Link>
      </div>

      {canDecide && (
        <div className="seg-tabs" role="tablist" aria-label="Sales views">
          {(
            [
              ['mine', 'My sales'],
              ['decide', auth.isAdmin ? 'Approvals' : 'Team approvals'],
              ['all', auth.isAdmin ? 'All sales' : 'Team sales'],
            ] as const
          ).map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'seg-tab active' : 'seg-tab'} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab !== 'decide' && (
        <div className="toolbar">
          <label>
            Status
            <select value={status ?? ''} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {SALE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
      )}

      {sales.status !== 'ready' ? (
        <RemoteStatus remote={sales} what="sales" />
      ) : sales.data.length === 0 ? (
        <div className="empty">
          <p>{tab === 'decide' ? 'No sales are waiting for your approval.' : 'No sales yet.'}</p>
        </div>
      ) : (
        <ul className="sale-list">
          {sales.data.map((s) => (
            <SaleCard key={s.id} sale={s} showSeller={tab !== 'mine'} onChanged={() => setVersion((v) => v + 1)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SaleCard({ sale: s, showSeller, onChanged }: { sale: Sale; showSeller: boolean; onChanged: () => void }) {
  const auth = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<'idle' | 'reject' | 'void'>('idle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setMode('idle');
      setReason('');
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) auth.refresh();
      setError(err instanceof ApiError ? err.message : "Couldn't update the sale.");
    } finally {
      setBusy(false);
    }
  };

  const onReason = (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Give a reason');
      return;
    }
    void run(() => (mode === 'reject' ? rejectSale(s.id, reason) : voidSale(s.id, reason)));
  };

  const discount = s.listPrice - s.salePrice;

  return (
    <li className="sale-card">
      <div className="sale-main">
        <div>
          <span className={`pill sale-${s.status.toLowerCase()}`}>{s.status}</span>{' '}
          <Link to={`/vehicles/${s.vehicle.id}`} state={{ from: location.pathname + location.search }} className="row-link">
            {s.vehicle.title}
          </Link>{' '}
          <span className="mono muted">{s.vehicle.stockNumber}</span>
        </div>
        <div className="sale-price">{formatPrice(s.salePrice)}</div>
      </div>
      <dl className="sale-meta">
        <div><dt>Sold</dt><dd>{formatDayLong(s.saleDate)}</dd></div>
        <div><dt>Buyer</dt><dd>{s.buyerName}</dd></div>
        {showSeller && <div><dt>Sold by</dt><dd>{s.soldBy.username}</dd></div>}
        <div><dt>List price</dt><dd>{formatPrice(s.listPrice)}{discount > 0 && <span className="muted"> (−{formatPrice(discount)})</span>}</dd></div>
        {s.monthUnit !== null && <div><dt>Unit this month</dt><dd>#{s.monthUnit}</dd></div>}
        {s.perk !== null && <div><dt>Perk</dt><dd className="strong">{formatMoney(s.perk)}</dd></div>}
        {s.override !== null && s.manager && <div><dt>Override ({s.manager.username})</dt><dd>{formatMoney(s.override)}</dd></div>}
        {s.leadId && <div><dt>Lead</dt><dd><Link to={`/leads/${s.leadId}`} className="row-link">View lead</Link></dd></div>}
      </dl>
      {s.notes && <p className="comment-body sale-notes">{s.notes}</p>}
      {s.status === 'Rejected' && s.rejectReason && <p className="field-hint">Rejected by {s.decidedBy}: {s.rejectReason}</p>}
      {s.status === 'Voided' && s.voidReason && <p className="field-hint">Voided: {s.voidReason}</p>}
      {s.status === 'Approved' && s.decidedBy && <p className="field-hint">Approved by {s.decidedBy}</p>}

      {(s.canDecide || s.canVoid) && mode === 'idle' && (
        <div className="request-actions sale-actions">
          {s.canDecide && (
            <>
              <button type="button" className="button" disabled={busy} onClick={() => void run(() => approveSale(s.id))}>
                {busy ? 'Saving…' : 'Approve'}
              </button>
              <button type="button" className="button button-danger-outline" disabled={busy} onClick={() => setMode('reject')}>Reject</button>
            </>
          )}
          {s.canVoid && (
            <button type="button" className="button button-danger-outline" disabled={busy} onClick={() => setMode('void')}>Void sale</button>
          )}
        </div>
      )}
      {mode !== 'idle' && (
        <form className="reason-form" onSubmit={onReason}>
          <label htmlFor={`reason-${s.id}`}>
            {mode === 'reject' ? 'Why is this sale rejected?' : 'Why is this sale voided? Its perk and override will be reversed.'}
          </label>
          <input id={`reason-${s.id}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} autoFocus />
          <div className="request-actions">
            <button type="submit" className="button button-danger" disabled={busy}>{mode === 'reject' ? 'Reject sale' : 'Void sale'}</button>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => { setMode('idle'); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </li>
  );
}
