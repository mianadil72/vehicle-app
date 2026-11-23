import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  ApiError,
  addAdjustment,
  closePayPeriod,
  fetchPayPeriods,
  fetchStatement,
  fetchTeamStatements,
  fetchWeeklyStats,
  payrollCsvUrl,
  useRemote,
} from '../api';
import { useAuth } from '../auth';
import { RemoteStatus } from '../components/RemoteStatus';
import { WeeklyChart } from '../components/WeeklyChart';
import { formatDateTime, formatDay, formatMoney, formatPeriod, formatPrice } from '../format';
import type { EarningType, PayPeriod, PayStatement, WeeklyStats } from '../types';

const TYPE_LABELS: Record<EarningType, string> = {
  Salary: 'Base salary',
  Perk: 'Perk',
  Override: 'Manager override',
  PerkReversal: 'Perk reversed',
  OverrideReversal: 'Override reversed',
  Adjustment: 'Adjustment',
};
const WEEKS = 9;

/** `/earnings` (sales team): my pay statement and weekly stats; managers also their team; admins everyone. */
export function EarningsPage() {
  const auth = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'team' && auth.isLeadManager ? 'team' : 'me';
  const periods = useRemote('pay-periods', (signal) => fetchPayPeriods(signal));
  const [version, setVersion] = useState(0);

  useEffect(() => {
    document.title = 'Earnings | ONE-STOP VEHICLE SHOP DEALERSHIP';
  }, []);

  if (periods.status !== 'ready') return <RemoteStatus remote={periods} what="pay periods" />;
  const period = periods.data.periods.find((p) => p.start === params.get('period')) ?? periods.data.periods[0];
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: key !== 'tab' });
  };

  return (
    <div className="leads-page">
      <div className="dashboard-head">
        <div>
          <h1>Earnings</h1>
          <p className="dashboard-sub">Bi-weekly pay: base salary plus perks for approved sales{auth.isLeadManager ? ' and overrides on your team’s sales' : ''}.</p>
        </div>
        <label className="period-picker">
          <span className="kpi-label">Pay period</span>
          <select value={period.start} onChange={(e) => set('period', e.target.value)}>
            {periods.data.periods.map((p) => (
              <option key={p.start} value={p.start}>
                {formatPeriod(p.start, p.end)}{p.start === periods.data.current ? ' (current)' : p.status === 'Closed' ? '' : ' (open)'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {auth.isLeadManager && (
        <div className="seg-tabs" role="tablist" aria-label="Earnings views">
          <button type="button" role="tab" aria-selected={tab === 'me'} className={tab === 'me' ? 'seg-tab active' : 'seg-tab'} onClick={() => set('tab', null)}>My pay</button>
          <button type="button" role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'seg-tab active' : 'seg-tab'} onClick={() => set('tab', 'team')}>
            {auth.isAdmin ? 'All staff' : 'My team'}
          </button>
        </div>
      )}

      {tab === 'me' ? (
        <>
          <Statement key={`${period.start}-${version}`} period={period} />
          <MyWeekly />
        </>
      ) : (
        <TeamView
          key={`${period.start}-${version}`}
          period={period}
          personId={params.get('user')}
          onPerson={(id) => set('user', id)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}

function Statement({ period, userId }: { period: PayPeriod; userId?: string }) {
  const statement = useRemote(`statement-${userId ?? 'me'}-${period.start}`, (signal) => fetchStatement({ user: userId, period: period.start }, signal));
  if (statement.status !== 'ready') return <RemoteStatus remote={statement} what="the pay statement" />;
  return <StatementView s={statement.data} />;
}

function StatementView({ s }: { s: PayStatement }) {
  const t = s.totals;
  return (
    <section className="panel statement" aria-labelledby="statement-title">
      <div className="statement-head">
        <div>
          <h2 className="panel-title" id="statement-title">
            {s.user.username} · {formatPeriod(s.period.start, s.period.end)}
          </h2>
          <p className="field-hint">
            {s.preview ? (
              <><span className="pill pill-neutral">Preview</span> This period is open: amounts can still change, and the salary is added when it closes.</>
            ) : (
              <><span className="pill sale-approved">Final</span> Closed {s.period.closedAt ? formatDateTime(s.period.closedAt) : ''}.</>
            )}
          </p>
        </div>
        <div className="statement-total">
          <span className="kpi-label">Total</span>
          <span className="kpi-value">{formatMoney(t.total)}</span>
        </div>
      </div>
      <div className="kpis statement-kpis">
        <div className="kpi"><p className="kpi-label">Base salary</p><p className="kpi-value">{formatMoney(t.salary)}</p></div>
        <div className="kpi"><p className="kpi-label">Perks</p><p className="kpi-value">{formatMoney(t.perks)}</p></div>
        {(s.user.role !== 'sales' || t.overrides !== 0) && (
          <div className="kpi"><p className="kpi-label">Overrides</p><p className="kpi-value">{formatMoney(t.overrides)}</p></div>
        )}
        {t.adjustments !== 0 && <div className="kpi"><p className="kpi-label">Adjustments</p><p className="kpi-value">{formatMoney(t.adjustments)}</p></div>}
      </div>
      {s.lines.length === 0 ? (
        <p className="comments-empty">Nothing earned in this period yet.</p>
      ) : (
        <div className="table-wrap table-cards-wrap">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Item</th>
                <th>Details</th>
                <th>Date</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {s.lines.map((l) => (
                <tr key={l.id} className={l.amount < 0 ? 'negative' : undefined}>
                  <td className="cell-title">{TYPE_LABELS[l.type]}{l.projected && <span className="pill pill-neutral"> projected</span>}</td>
                  <td data-label="Details" className="wrap">{[l.saleTitle, l.note].filter(Boolean).join(' · ')}</td>
                  <td data-label="Date">{l.projected ? '—' : formatDateTime(l.createdAt)}</td>
                  <td data-label="Amount" className="num strong">{formatMoney(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MyWeekly() {
  const stats = useRemote('weekly-me', (signal) => fetchWeeklyStats('me', WEEKS, signal));
  if (stats.status !== 'ready') return <RemoteStatus remote={stats} what="weekly stats" />;
  const s = stats.data;
  const me = s.people[0];
  if (!me) return null;
  return <WeeklyPanel stats={s} rows={me.byWeek} title="My vehicles sold per week" showPay />;
}

function WeeklyPanel({ stats, rows, title, showPay }: { stats: WeeklyStats; rows: WeeklyStats['totals']; title: string; showPay: boolean }) {
  const thisWeek = rows[rows.length - 1];
  const lastWeek = rows[rows.length - 2];
  return (
    <section className="panel">
      <div className="kpis">
        <div className="kpi kpi-hero">
          <p className="kpi-label">Sold this week</p>
          <p className="kpi-value">{thisWeek.units}</p>
          <p className="kpi-detail">{lastWeek ? `${lastWeek.units} last week` : ''}{thisWeek.pending ? ` · ${thisWeek.pending} pending approval` : ''}</p>
        </div>
        <div className="kpi"><p className="kpi-label">Revenue this week</p><p className="kpi-value">{formatPrice(thisWeek.revenue)}</p></div>
        {showPay && <div className="kpi"><p className="kpi-label">Perks + overrides this week</p><p className="kpi-value">{formatMoney(thisWeek.perks + thisWeek.overrides)}</p></div>}
        <div className="kpi"><p className="kpi-label">Follow-ups this week</p><p className="kpi-value">{thisWeek.followUps}</p><p className="kpi-detail">{thisWeek.leadsWon} leads won</p></div>
      </div>
      <WeeklyChart weeks={stats.weeks} units={rows.map((r) => r.units)} title={title} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Week of</th>
              <th className="num">Sold</th>
              <th className="num">Revenue</th>
              {showPay && <th className="num">Perks</th>}
              {showPay && <th className="num">Overrides</th>}
              <th className="num">Pending</th>
              <th className="num">Leads assigned</th>
              <th className="num">Follow-ups</th>
              <th className="num">Leads won</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r, i) => {
              const week = stats.weeks[stats.weeks.length - 1 - i];
              return (
                <tr key={week}>
                  <td>{formatDay(week)}{i === 0 && <span className="muted"> (this week)</span>}</td>
                  <td className="num strong">{r.units}</td>
                  <td className="num">{formatPrice(r.revenue)}</td>
                  {showPay && <td className="num">{formatMoney(r.perks)}</td>}
                  {showPay && <td className="num">{formatMoney(r.overrides)}</td>}
                  <td className="num">{r.pending}</td>
                  <td className="num">{r.leadsAssigned}</td>
                  <td className="num">{r.followUps}</td>
                  <td className="num">{r.leadsWon}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TeamView(props: { period: PayPeriod; personId: string | null; onPerson: (id: string | null) => void; onChanged: () => void }) {
  const auth = useAuth();
  const scope = auth.isAdmin ? 'all' : 'team';
  const statements = useRemote(`team-statements-${scope}-${props.period.start}`, (signal) => fetchTeamStatements(props.period.start, scope, signal));
  const stats = useRemote(`weekly-${scope}`, (signal) => fetchWeeklyStats(scope, WEEKS, signal));

  if (statements.status !== 'ready') return <RemoteStatus remote={statements} what="statements" />;
  const list = statements.data;
  const person = list.find((s) => s.user.id === props.personId);
  const total = list.reduce((sum, s) => sum + Math.round(s.totals.total * 100), 0) / 100;

  return (
    <>
      {auth.isAdmin && <AdminActions period={props.period} people={list} onChanged={props.onChanged} />}
      <section className="panel">
        <h2 className="panel-title">
          {auth.isAdmin ? 'All staff' : 'My team'} · {formatPeriod(props.period.start, props.period.end)} · {formatMoney(total)}
        </h2>
        <div className="table-wrap table-cards-wrap">
          <table className="table-cards">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th className="num">Salary</th>
                <th className="num">Perks</th>
                <th className="num">Overrides</th>
                <th className="num">Adjustments</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.user.id} className={s.user.id === props.personId ? 'selected' : undefined}>
                  <td className="cell-title">
                    <button type="button" className="account-link" onClick={() => props.onPerson(s.user.id === props.personId ? null : s.user.id)}>
                      {s.user.username}
                    </button>
                  </td>
                  <td data-label="Role">{s.user.role === 'manager' ? 'Manager' : s.user.role === 'sales' ? 'Sales rep' : 'Admin'}</td>
                  <td data-label="Salary" className="num">{formatMoney(s.totals.salary)}</td>
                  <td data-label="Perks" className="num">{formatMoney(s.totals.perks)}</td>
                  <td data-label="Overrides" className="num">{formatMoney(s.totals.overrides)}</td>
                  <td data-label="Adjustments" className="num">{formatMoney(s.totals.adjustments)}</td>
                  <td data-label="Total" className="num strong">{formatMoney(s.totals.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {person && <StatementView s={person} />}

      {stats.status !== 'ready' ? (
        <RemoteStatus remote={stats} what="weekly stats" />
      ) : (
        <>
          <WeeklyPanel stats={stats.data} rows={stats.data.totals} title={auth.isAdmin ? 'Dealership vehicles sold per week' : 'Team vehicles sold per week'} showPay={false} />
          <Leaderboard stats={stats.data} />
        </>
      )}
    </>
  );
}

/** Ranked by vehicles sold this week, then this period of weeks. No pay amounts. */
function Leaderboard({ stats }: { stats: WeeklyStats }) {
  const last = stats.weeks.length - 1;
  const ranked = [...stats.people].sort((a, b) => b.byWeek[last].units - a.byWeek[last].units || b.total.units - a.total.units || a.user.username.localeCompare(b.user.username));
  return (
    <section className="panel">
      <h2 className="panel-title">This week’s ranking</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Person</th>
              <th className="num">Sold this week</th>
              <th className="num">Revenue this week</th>
              <th className="num">Sold, last {stats.weeks.length} weeks</th>
              <th className="num">Follow-ups this week</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((p, i) => (
              <tr key={p.user.id}>
                <td className="num">{i + 1}</td>
                <td className="strong">{p.user.username}{p.user.role === 'manager' && <span className="muted"> (manager)</span>}</td>
                <td className="num strong">{p.byWeek[last].units}</td>
                <td className="num">{formatPrice(p.byWeek[last].revenue)}</td>
                <td className="num">{p.total.units}</td>
                <td className="num">{p.byWeek[last].followUps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdminActions({ period, people, onChanged }: { period: PayPeriod; people: PayStatement[]; onChanged: () => void }) {
  const auth = useAuth();
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [todayDate] = useState(() => new Intl.DateTimeFormat('en-CA').format(new Date()));
  const ended = period.end < todayDate;

  const fail = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) auth.refresh();
    setMessage({ ok: false, text: err instanceof ApiError ? Object.values(err.fields)[0] ?? err.message : fallback });
  };

  const onAdjust = async (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!userId || !Number.isFinite(value) || value === 0 || !note.trim()) {
      setMessage({ ok: false, text: 'Choose a person, enter a non-zero amount (negative to deduct) and a note.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const r = await addAdjustment(userId, value, note);
      setMessage({ ok: true, text: `Adjustment added to the period starting ${formatDay(r.period)}.` });
      setAmount('');
      setNote('');
      onChanged();
    } catch (err) {
      fail(err, "Couldn't add the adjustment.");
    } finally {
      setBusy(false);
    }
  };

  const onClose = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await closePayPeriod(period.start);
      setConfirmClose(false);
      onChanged();
    } catch (err) {
      fail(err, "Couldn't close the period.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="payroll-title">
      <h2 className="panel-title" id="payroll-title">Payroll</h2>
      <div className="request-actions payroll-actions">
        <a className="button button-secondary" href={payrollCsvUrl(period.start)} download>Export CSV</a>
        {period.status === 'Open' &&
          (confirmClose ? (
            <>
              <button type="button" className="button" disabled={busy} onClick={() => void onClose()}>Close {formatPeriod(period.start, period.end)}</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => setConfirmClose(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="button" disabled={!ended || busy} onClick={() => setConfirmClose(true)} title={ended ? undefined : 'A period can be closed after it ends'}>
              Close period…
            </button>
          ))}
      </div>
      {confirmClose && <p className="field-hint">Closing adds everyone’s base salary and locks the period. Later changes go into the next open period.</p>}
      {period.status === 'Open' && !ended && <p className="field-hint">This period can be closed after {formatDay(period.end)}.</p>}

      <form className="adjust-form" onSubmit={onAdjust}>
        <h3 className="lead-subtitle">Add an adjustment (current open period)</h3>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="adj-user">Person</label>
            <select id="adj-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Choose…</option>
              {people.map((p) => <option key={p.user.id} value={p.user.id}>{p.user.username}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="adj-amount">Amount (USD, negative to deduct)</label>
            {/* Plain text keyboard: the iOS decimal pad has no minus sign for deductions. */}
            <input id="adj-amount" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100 or -50" />
          </div>
          <div className="field field-wide">
            <label htmlFor="adj-note">Note</label>
            <input id="adj-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Spot bonus for weekend event" />
          </div>
        </div>
        <div className="form-actions">
          <button type="submit" className="button" disabled={busy}>Add adjustment</button>
        </div>
      </form>
      {message && <p className={message.ok ? 'notice' : 'field-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
    </section>
  );
}
