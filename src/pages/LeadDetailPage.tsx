import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import {
  ApiError,
  assignLead,
  closeLead,
  fetchLead,
  fetchSalesReps,
  logFollowUp,
  resendLeadNotification,
  useRemote,
} from '../api';
import { useAuth } from '../auth';
import { LeadStatusPill, NextDue } from '../components/LeadStatus';
import { RemoteStatus } from '../components/RemoteStatus';
import { formatDate, formatDateTime, formatPrice, formatUrgency } from '../format';
import type { NavState } from '../navigation';
import {
  CLOSED_LEAD_STATUSES,
  CONTACT_METHODS,
  FOLLOW_UP_INTERVAL_DAYS,
  LEAD_NOTE_MAX_LENGTH,
  MAX_FOLLOW_UPS,
  leadReference,
  type ContactMethod,
  type Lead,
} from '../types';

const ORDINAL = ['1st', '2nd', '3rd'];
const SOURCE_LABELS: Record<Lead['source'], string> = { contact: 'Contact form', vehicle: 'Vehicle page', chat: 'Chat assistant' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** Turns API errors into a message for the user; refreshes the session on 401/403. */
function useErrorText() {
  const auth = useAuth();
  return (err: unknown, fallback: string) => {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      auth.refresh();
      return err.status === 401 ? 'Your session has ended. Sign in again.' : err.message;
    }
    return err instanceof ApiError ? err.message : fallback;
  };
}

/** `/leads/:id` (sales team): one customer lead, its follow-ups, assignment and outcome. */
export function LeadDetailPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const from = (location.state as NavState | null)?.from;
  const backTo = from?.startsWith('/leads') ? from : '/leads';
  const remote = useRemote(`lead-${id}`, (signal) => fetchLead(id, signal));
  // The lead as returned by the last change made on this page (assign, follow-up, close…).
  const [updated, setUpdated] = useState<Lead | null>(null);
  const lead = updated?.id === id ? updated : remote.status === 'ready' ? remote.data : null;

  useEffect(() => {
    document.title = `Lead ${leadReference(id)} | ONE-STOP VEHICLE SHOP DEALERSHIP`;
  }, [id]);

  const breadcrumb = (
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <Link to={backTo}>← Back to leads</Link>
    </nav>
  );

  if (remote.status !== 'ready' && !lead) {
    return (
      <>
        {breadcrumb}
        <RemoteStatus remote={remote} what="this lead" />
      </>
    );
  }

  if (!lead) {
    return (
      <>
        {breadcrumb}
        <div className="empty detail-missing">
          <h2>Lead not found</h2>
          <p>It doesn't exist, or it's assigned to another sales rep.</p>
          <Link to="/leads" className="button">All leads</Link>
        </div>
      </>
    );
  }

  return (
    <>
      {breadcrumb}
      <div className="lead-head">
        <div>
          <p className="card-year mono">{leadReference(lead.id)}</p>
          <h1 className="detail-title">{lead.customerName}</h1>
          <div className="detail-pills">
            <LeadStatusPill status={lead.status} />
            <span className={`pill cond-${lead.interestCondition.toLowerCase()}`}>{lead.interestCondition}</span>
            <span className="pill pill-neutral">Buying {formatUrgency(lead.urgencyDays)}</span>
          </div>
        </div>
        <div className="lead-next">
          <span className="kpi-label">Next follow-up</span>
          <NextDue lead={lead} />
        </div>
      </div>

      <div className="lead-layout">
        <div className="stack">
          <CustomerCard lead={lead} />
          <FollowUps lead={lead} onChange={setUpdated} />
        </div>
        <div className="stack">
          <Assignment lead={lead} onChange={setUpdated} />
          <Outcome lead={lead} onChange={setUpdated} />
          <Notifications lead={lead} onChange={setUpdated} />
        </div>
      </div>
    </>
  );
}

function CustomerCard({ lead }: { lead: Lead }) {
  const { customer: c } = lead;
  const location = useLocation();
  const buyBy = new Date(new Date(lead.createdAt).getTime() + lead.urgencyDays * DAY_MS).toISOString();
  const preferred = (m: ContactMethod) => (lead.preferredContact === m ? <span className="pill pill-neutral">Preferred</span> : null);
  return (
    <section className="panel" aria-labelledby="customer-title">
      <h2 className="panel-title" id="customer-title">Customer</h2>
      <dl className="detail-specs lead-specs">
        <div>
          <dt>Email</dt>
          <dd><a href={`mailto:${c.email}`}>{c.email}</a> {preferred('Email')}</dd>
        </div>
        <div>
          <dt>Mobile</dt>
          <dd>
            <a href={`tel:${c.mobile}`}>{c.mobile}</a> · <a href={`sms:${c.mobile}`}>Text</a> {preferred('Phone')} {preferred('Text')}
          </dd>
        </div>
        <div>
          <dt>Prefers</dt>
          <dd>{lead.preferredContact === 'Phone' ? 'Phone call' : lead.preferredContact === 'Text' ? 'Text message' : 'Email'}</dd>
        </div>
        <div>
          <dt>Looking for</dt>
          <dd>{lead.interestCondition === 'Certified' ? 'Certified pre-owned' : lead.interestCondition} vehicle</dd>
        </div>
        <div>
          <dt>Wants to buy</dt>
          <dd>{formatUrgency(lead.urgencyDays)} (by {formatDate(buyBy)})</dd>
        </div>
        <div>
          <dt>Vehicle</dt>
          <dd>
            {lead.vehicle ? (
              <>
                <Link to={`/vehicles/${lead.vehicle.id}`} state={{ from: location.pathname }}>{lead.vehicle.title}</Link>
                {' '}· {formatPrice(lead.vehicle.price)} · <span className="mono">{lead.vehicle.stockNumber}</span>
              </>
            ) : (
              <span className="muted">None chosen</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{SOURCE_LABELS[lead.source]}</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd><time dateTime={lead.createdAt}>{formatDateTime(lead.createdAt)}</time></dd>
        </div>
      </dl>
      <ReturningCustomer lead={lead} />
      {lead.message && (
        <>
          <h3 className="lead-subtitle">Message</h3>
          <p className="comment-body">{lead.message}</p>
        </>
      )}
    </section>
  );
}

/**
 * Earlier enquiries from the same customer (email), and their details on file when this enquiry's differ.
 * Each enquiry keeps the details it was submitted with; nothing is overwritten.
 */
function ReturningCustomer({ lead }: { lead: Lead }) {
  const location = useLocation();
  const { otherLeads, customerSince, onFile } = lead.returning;
  if (otherLeads.length === 0) return null;
  const c = lead.customer;
  const rows: [string, string, string][] = onFile
    ? [
        ['Name', `${onFile.firstName} ${onFile.lastName}`, `${c.firstName} ${c.lastName}`],
        ['Mobile', onFile.mobile, c.mobile],
        ['Prefers', onFile.preferredContact, lead.preferredContact],
      ]
    : [];
  return (
    <div className="returning">
      <h3 className="lead-subtitle">
        Returning customer <span className="pill pill-neutral">{otherLeads.length + 1} enquiries</span>
      </h3>
      <p className="field-hint">
        First contact <time dateTime={customerSince}>{formatDate(customerSince)}</time>. Earlier enquiries:{' '}
        {otherLeads.map((o, i) => (
          <span key={o.id}>
            {i > 0 && ', '}
            <Link to={`/leads/${o.id}`} state={{ from: location.pathname }} className="mono">{leadReference(o.id)}</Link>{' '}
            <LeadStatusPill status={o.status} />
          </span>
        ))}
      </p>
      {onFile && (
        <div className="table-wrap returning-diff">
          <table>
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">On file (first enquiry)</th>
                <th scope="col">This enquiry</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, before, now]) => (
                <tr key={label} className={before !== now ? 'changed' : undefined}>
                  <th scope="row">{label}</th>
                  <td>{before}</td>
                  <td>
                    {now}
                    {before !== now && <span className="pill pill-overdue">Changed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FollowUps({ lead, onChange }: { lead: Lead; onChange: (lead: Lead) => void }) {
  const auth = useAuth();
  const errorText = useErrorText();
  const [method, setMethod] = useState<ContactMethod>(lead.preferredContact);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const closed = CLOSED_LEAD_STATUSES.includes(lead.status);
  const mine = lead.assignedTo?.id === auth.user?.id;
  const canLog = !closed && lead.assignedTo !== null && lead.followUps < MAX_FOLLOW_UPS && (mine || auth.isLeadManager);
  const nextNumber = lead.followUps + 1;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!note.trim()) {
      setErrors({ note: 'Add a short note about the follow-up' });
      return;
    }
    setSaving(true);
    try {
      onChange(await logFollowUp(lead.id, method, note.trim()));
      setNote('');
      setErrors({});
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) setErrors(err.fields);
      else setFormError(errorText(err, "Couldn't save the follow-up."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="followups-title">
      <h2 className="panel-title" id="followups-title">Follow-ups</h2>
      <p className="field-hint">
        The 1st follow-up is due {FOLLOW_UP_INTERVAL_DAYS} days after the lead arrives; each later one {FOLLOW_UP_INTERVAL_DAYS} days after the previous.
      </p>
      <ol className="followups">
        {ORDINAL.map((label, i) => {
          const n = i + 1;
          const done = lead.followUpList.find((f) => f.number === n);
          return (
            <li key={n} className={done ? 'followup done' : n === nextNumber && !closed ? 'followup next' : 'followup'}>
              <div className="followup-head">
                <strong>{label} follow-up</strong>
                {done ? (
                  <span className="field-hint">
                    <time dateTime={done.createdAt}>{formatDateTime(done.createdAt)}</time> · {done.method} · {done.author}
                  </span>
                ) : n === nextNumber && !closed && lead.nextFollowUpDue ? (
                  <span className="field-hint">Due {formatDate(lead.nextFollowUpDue)}</span>
                ) : (
                  <span className="field-hint">{closed ? 'Not needed' : n === 1 ? 'Assign the lead first' : `${FOLLOW_UP_INTERVAL_DAYS} days after the ${ORDINAL[i - 1]}`}</span>
                )}
              </div>
              {done && <p className="comment-body">{done.note}</p>}
            </li>
          );
        })}
      </ol>

      {canLog && (
        <form className="followup-form stack" onSubmit={onSubmit} noValidate>
          <h3 className="lead-subtitle">Log the {ORDINAL[nextNumber - 1]} follow-up</h3>
          {formError && <div className="alert-error" role="alert">{formError}</div>}
          <fieldset disabled={saving} className="stack">
            <div className="field">
              <label htmlFor="followup-method">Contacted by</label>
              <select id="followup-method" value={method} onChange={(e) => setMethod(e.target.value as ContactMethod)}>
                {CONTACT_METHODS.map((m) => (
                  <option key={m} value={m}>{m === 'Phone' ? 'Phone call' : m === 'Text' ? 'Text message' : 'Email'}{m === lead.preferredContact ? ' (preferred)' : ''}</option>
                ))}
              </select>
              {errors.method && <p className="field-error">{errors.method}</p>}
            </div>
            <div className="field">
              <label htmlFor="followup-note">Note</label>
              <textarea
                id="followup-note"
                rows={3}
                maxLength={LEAD_NOTE_MAX_LENGTH}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What happened? e.g. Left voicemail; booked a test drive for Saturday."
                aria-invalid={errors.note ? true : undefined}
                aria-describedby={errors.note ? 'followup-note-error' : undefined}
                className="lead-message"
              />
              {errors.note && <p className="field-error" id="followup-note-error">{errors.note}</p>}
            </div>
          </fieldset>
          <div className="form-actions">
            <button type="submit" className="button" disabled={saving}>
              {saving ? 'Saving…' : `Mark ${ORDINAL[nextNumber - 1]} follow-up done`}
            </button>
          </div>
        </form>
      )}
      {!closed && lead.assignedTo && !mine && !auth.isLeadManager && (
        <p className="field-hint">Only {lead.assignedTo.username} can log follow-ups on this lead.</p>
      )}
    </section>
  );
}

function Assignment({ lead, onChange }: { lead: Lead; onChange: (lead: Lead) => void }) {
  const auth = useAuth();
  const errorText = useErrorText();
  const closed = CLOSED_LEAD_STATUSES.includes(lead.status);
  const reps = useRemote(auth.isLeadManager && !closed ? 'sales-reps' : null, (signal) => fetchSalesReps(signal));
  const [choice, setChoice] = useState(lead.assignedTo?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAssign = async (e: FormEvent) => {
    e.preventDefault();
    if (!choice) {
      setError('Choose a sales rep');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onChange(await assignLead(lead.id, choice));
    } catch (err) {
      setError(errorText(err, "Couldn't assign the lead."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="assign-title">
      <h2 className="panel-title" id="assign-title">Sales rep</h2>
      <p>
        {lead.assignedTo ? (
          <>
            <strong>{lead.assignedTo.id === auth.user?.id ? 'You' : lead.assignedTo.username}</strong>
            {lead.assignedAt && <span className="field-hint"> · since {formatDateTime(lead.assignedAt)}</span>}
          </>
        ) : (
          <span className="muted">Not assigned yet</span>
        )}
      </p>
      {auth.isLeadManager && !closed && (
        <form onSubmit={onAssign} className="assign-form">
          <label htmlFor="assign-rep" className="visually-hidden">Sales rep</label>
          <select id="assign-rep" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={saving || reps.status !== 'ready'}>
            <option value="">{reps.status === 'ready' ? 'Choose a sales rep…' : 'Loading…'}</option>
            {reps.status === 'ready' &&
              reps.data.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.username}{r.role === 'manager' ? ' (manager)' : ''} · {r.openLeads} open
                </option>
              ))}
          </select>
          <button type="submit" className="button" disabled={saving || !choice || choice === lead.assignedTo?.id}>
            {saving ? 'Saving…' : lead.assignedTo ? 'Reassign' : 'Assign'}
          </button>
          {reps.status === 'ready' && reps.data.length === 0 && (
            <p className="field-hint">No sales reps yet. Create one with <code>npm run user -- &lt;name&gt; --role sales</code>.</p>
          )}
          {error && <p className="field-error" role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}

function Outcome({ lead, onChange }: { lead: Lead; onChange: (lead: Lead) => void }) {
  const auth = useAuth();
  const errorText = useErrorText();
  const [confirming, setConfirming] = useState<'Won' | 'Lost' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = CLOSED_LEAD_STATUSES.includes(lead.status);
  const canClose = auth.isLeadManager || lead.assignedTo?.id === auth.user?.id;

  if (closed) {
    return (
      <section className="panel">
        <h2 className="panel-title">Outcome</h2>
        <p>
          <LeadStatusPill status={lead.status} /> {lead.closedAt && <span className="field-hint">on {formatDateTime(lead.closedAt)}</span>}
        </p>
      </section>
    );
  }
  if (!canClose) return null;

  const onClose = async (outcome: 'Won' | 'Lost') => {
    setSaving(true);
    setError(null);
    try {
      onChange(await closeLead(lead.id, outcome));
      setConfirming(null);
    } catch (err) {
      setError(errorText(err, "Couldn't close the lead."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <h2 className="panel-title">Outcome</h2>
      {confirming ? (
        <div className="confirm" role="alertdialog" aria-labelledby="close-title">
          <p id="close-title" className="confirm-title">Mark this lead {confirming === 'Won' ? 'won (sold)' : 'lost'}?</p>
          <p>It will be closed and no more follow-ups will be due.</p>
          <div className="form-actions">
            <button type="button" className={confirming === 'Won' ? 'button' : 'button button-danger'} onClick={() => onClose(confirming)} disabled={saving} autoFocus>
              {saving ? 'Saving…' : `Mark ${confirming.toLowerCase()}`}
            </button>
            <button type="button" className="button button-secondary" onClick={() => setConfirming(null)} disabled={saving}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          {lead.vehicle && (
            <p className="field-hint">
              Sold the {lead.vehicle.title}? Record the sale: when your manager approves it, this lead is marked won and the perk is added to your pay.
            </p>
          )}
          <div className="request-actions">
            {lead.vehicle && <Link to={`/sales/new?lead=${lead.id}`} className="button">Record sale</Link>}
            <button type="button" className={lead.vehicle ? 'button button-secondary' : 'button'} onClick={() => setConfirming('Won')}>Won</button>
            <button type="button" className="button button-danger-outline" onClick={() => setConfirming('Lost')}>Lost</button>
          </div>
        </>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}

function Notifications({ lead, onChange }: { lead: Lead; onChange: (lead: Lead) => void }) {
  const auth = useAuth();
  const errorText = useErrorText();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!auth.isLeadManager) return null;

  const resend = async () => {
    setSending(true);
    setError(null);
    try {
      onChange(await resendLeadNotification(lead.id));
    } catch (err) {
      setError(errorText(err, "Couldn't send the notification."));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="notify-title">
      <h2 className="panel-title" id="notify-title">Manager notifications</h2>
      {lead.notifications.length === 0 ? (
        <p className="field-hint">None sent. Set LEAD_MANAGER_EMAIL / LEAD_MANAGER_SMS on the server.</p>
      ) : (
        <ul className="notification-list">
          {lead.notifications.map((n, i) => (
            <li key={i}>
              <span className={`pill notify-${n.status.toLowerCase()}`}>{n.status === 'Logged' ? 'Console only' : n.status}</span>{' '}
              {n.channel === 'sms' ? 'Text' : 'Email'} to <span className="mono">{n.recipient}</span>
              <div className="field-hint">
                <time dateTime={n.createdAt}>{formatDateTime(n.createdAt)}</time>
                {n.error && <> · {n.error}</>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <button type="button" className="button button-secondary" onClick={resend} disabled={sending}>
          {sending ? 'Sending…' : 'Send again'}
        </button>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </section>
  );
}
