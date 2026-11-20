import { useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { fetchLeadCounts, fetchLeads, fetchSalesReps, useRemote } from '../api';
import { useAuth } from '../auth';
import { Pagination } from '../components/Pagination';
import { RemoteStatus } from '../components/RemoteStatus';
import { LeadStatusPill, NextDue } from '../components/LeadStatus';
import { formatDateTime, formatUrgency } from '../format';
import { PAGE_SIZES, type PageSize } from '../paging';
import { LEAD_STATUSES, LEAD_STATUS_LABELS, leadReference } from '../types';

type ParamKey = 'status' | 'assigned' | 'overdue' | 'page' | 'size';
const DEFAULTS: Record<ParamKey, string> = { status: 'open', assigned: '', overdue: '', page: '1', size: String(PAGE_SIZES[0]) };

/** `/leads` (sales team): customer leads. Managers see all of them; sales reps see the ones assigned to them. */
export function LeadsPage() {
  const auth = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const get = (k: ParamKey) => params.get(k) ?? DEFAULTS[k];
  const set = (k: ParamKey, value: string | number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const v = String(value);
        if (v === DEFAULTS[k]) next.delete(k);
        else next.set(k, v);
        if (k !== 'page') next.delete('page');
        return next;
      },
      { replace: k !== 'page' },
    );

  const status = get('status');
  const assigned = auth.isLeadManager ? get('assigned') : '';
  const overdue = get('overdue') === '1';
  const key = `leads-${status}-${assigned}-${overdue}`;
  const leads = useRemote(key, (signal) => fetchLeads({ status, assigned, overdue }, signal));
  const counts = useRemote(`lead-counts-${key}`, (signal) => fetchLeadCounts(signal));
  const reps = useRemote(auth.isLeadManager ? 'sales-reps' : null, (signal) => fetchSalesReps(signal));

  useEffect(() => {
    document.title = 'Leads | ONE-STOP VEHICLE SHOP DEALERSHIP';
  }, []);

  const all = leads.status === 'ready' ? leads.data : [];
  const size: PageSize = PAGE_SIZES.find((n) => String(n) === get('size')) ?? PAGE_SIZES[0];
  const pages = Math.max(1, Math.ceil(all.length / size));
  const page = Math.min(pages, Math.max(1, Math.trunc(Number(get('page'))) || 1));
  const rows = all.slice((page - 1) * size, page * size);
  const from = location.pathname + location.search;

  return (
    <div className="leads-page">
      <div className="dashboard-head">
        <div>
          <h1>Customer leads</h1>
          <p className="dashboard-sub">
            {auth.isLeadManager
              ? 'Assign new leads to a sales rep. Each lead gets up to 3 follow-ups, 2 days apart.'
              : 'Leads assigned to you. Log each follow-up: the next one is due 2 days later.'}
          </p>
        </div>
        <Link to="/contact" className="button button-secondary">New enquiry form</Link>
      </div>

      {counts.status === 'ready' && (
        <div className="kpis lead-kpis">
          <button type="button" className="kpi kpi-button" onClick={() => setParams(new URLSearchParams())}>
            <span className="kpi-label">Open</span>
            <span className="kpi-value">{counts.data.open}</span>
          </button>
          <button type="button" className="kpi kpi-button" onClick={() => setParams(new URLSearchParams({ overdue: '1' }))}>
            <span className="kpi-label">Overdue follow-ups</span>
            <span className={counts.data.overdue > 0 ? 'kpi-value text-danger' : 'kpi-value'}>{counts.data.overdue}</span>
          </button>
          {auth.isLeadManager && (
            <button type="button" className="kpi kpi-button" onClick={() => setParams(new URLSearchParams({ assigned: 'none' }))}>
              <span className="kpi-label">Waiting to be assigned</span>
              <span className="kpi-value">{counts.data.unassigned}</span>
            </button>
          )}
        </div>
      )}

      <div className="toolbar lead-toolbar">
        <label>
          Status
          <select value={status} onChange={(e) => set('status', e.target.value)}>
            <option value="open">Open</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
            ))}
            <option value="closed">Closed (won or lost)</option>
            <option value="all">All</option>
          </select>
        </label>
        {auth.isLeadManager && (
          <label>
            Assigned to
            <select value={assigned} onChange={(e) => set('assigned', e.target.value)}>
              <option value="">Anyone</option>
              <option value="none">Unassigned</option>
              <option value="me">Me</option>
              {reps.status === 'ready' &&
                reps.data.filter((r) => r.id !== auth.user?.id).map((r) => (
                  <option key={r.id} value={r.id}>{r.username}</option>
                ))}
            </select>
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={overdue} onChange={(e) => set('overdue', e.target.checked ? '1' : '')} />
          Overdue only
        </label>
      </div>

      {leads.status !== 'ready' ? (
        <RemoteStatus remote={leads} what="leads" />
      ) : all.length === 0 ? (
        <div className="empty">
          <p>No leads match these filters.</p>
        </div>
      ) : (
        <>
          <div className="list-head">
            <p className="summary">
              <strong>{all.length}</strong> lead{all.length === 1 ? '' : 's'}
            </p>
            <Pagination page={page} pages={pages} size={size} onPage={(p) => set('page', p)} onSize={(n) => set('size', n)} />
          </div>
          <div className="table-wrap table-cards-wrap">
            <table className="table-cards">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Customer</th>
                  <th>Looking for</th>
                  <th>Buying</th>
                  <th>Contact by</th>
                  <th>Status</th>
                  {auth.isLeadManager && <th>Assigned to</th>}
                  <th>Next follow-up</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td className="cell-title">
                      <Link to={`/leads/${l.id}`} state={{ from }} className="row-link">
                        <span className="mono">{leadReference(l.id)}</span>
                        <span className="cards-only"> · {l.customerName}</span>
                      </Link>
                    </td>
                    <td data-label="Customer" className="strong cards-hide">{l.customerName}</td>
                    <td data-label="Looking for">
                      <span className={`pill cond-${l.interestCondition.toLowerCase()}`}>{l.interestCondition}</span>
                      {l.vehicle && <span className="lead-vehicle"> {l.vehicle.title}</span>}
                    </td>
                    <td data-label="Buying">{formatUrgency(l.urgencyDays)}</td>
                    <td data-label="Contact by">{l.preferredContact}</td>
                    <td data-label="Status"><LeadStatusPill status={l.status} /></td>
                    {auth.isLeadManager && (
                      <td data-label="Assigned to">{l.assignedTo?.username ?? <span className="muted">Unassigned</span>}</td>
                    )}
                    <td data-label="Next follow-up"><NextDue lead={l} /></td>
                    <td data-label="Received"><time dateTime={l.createdAt}>{formatDateTime(l.createdAt)}</time></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="list-foot">
              <Pagination page={page} pages={pages} size={size} onPage={(p) => set('page', p)} onSize={(n) => set('size', n)} showSize={false} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
