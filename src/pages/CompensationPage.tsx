import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, createCompPlan, fetchCompPlans, fetchStaff, setManager, setSalary, useRemote } from '../api';
import { useAuth } from '../auth';
import { RemoteStatus } from '../components/RemoteStatus';
import { formatDayLong, formatMoney } from '../format';
import type { CompPlan, StaffMember } from '../types';

const localToday = () => new Intl.DateTimeFormat('en-CA').format(new Date());

/** `/admin/compensation` (admins): commission plan versions, salaries and rep → manager teams. */
export function CompensationPage() {
  const [version, setVersion] = useState(0);
  const plans = useRemote(`comp-plans-${version}`, (signal) => fetchCompPlans(signal));
  const staff = useRemote(`staff-${version}`, (signal) => fetchStaff(signal));

  useEffect(() => {
    document.title = 'Compensation | ONE-STOP VEHICLE SHOP DEALERSHIP';
  }, []);

  return (
    <div className="leads-page">
      <div className="dashboard-head">
        <div>
          <h1>Compensation</h1>
          <p className="dashboard-sub">
            Perk tiers and manager override, base salaries, and who reports to whom. Changes never alter perks already approved.
          </p>
        </div>
      </div>
      {plans.status !== 'ready' ? <RemoteStatus remote={plans} what="commission plans" /> : <Plans plans={plans.data} onSaved={() => setVersion((v) => v + 1)} />}
      {staff.status !== 'ready' ? <RemoteStatus remote={staff} what="staff" /> : <Staff staff={staff.data} onSaved={() => setVersion((v) => v + 1)} />}
    </div>
  );
}

function Plans({ plans, onSaved }: { plans: CompPlan[]; onSaved: () => void }) {
  const auth = useAuth();
  const today = localToday();
  const current = plans.find((p) => p.effectiveFrom <= today) ?? plans[plans.length - 1];
  const [editing, setEditing] = useState(false);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [override, setOverride] = useState(String(current?.managerOverride ?? 50));
  const [tiers, setTiers] = useState(current?.tiers.map((t) => ({ fromUnit: String(t.fromUnit), perVehicle: String(t.perVehicle) })) ?? [{ fromUnit: '1', perVehicle: '200' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createCompPlan({
        effectiveFrom,
        managerOverride: Number(override),
        tiers: tiers.map((t) => ({ fromUnit: Number(t.fromUnit), perVehicle: Number(t.perVehicle) })),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) auth.refresh();
      setError(err instanceof ApiError ? err.message : "Couldn't save the plan.");
    } finally {
      setSaving(false);
    }
  };

  const describe = (p: CompPlan) =>
    p.tiers.map((t, i) => {
      const next = p.tiers[i + 1];
      return `${next ? `Units ${t.fromUnit}–${next.fromUnit - 1}` : `Unit ${t.fromUnit}+`}: ${formatMoney(t.perVehicle)}`;
    });

  return (
    <section className="panel" aria-labelledby="plans-title">
      <h2 className="panel-title" id="plans-title">Perks and override</h2>
      <p className="field-hint">
        Each approved vehicle earns the rate of the tier it falls in, by the seller’s count of approved sales in that calendar month.
        Managers earn the override on every vehicle their reps sell.
      </p>
      <ul className="plan-list">
        {plans.map((p) => (
          <li key={p.id} className={p === current ? 'plan current' : 'plan'}>
            <div className="plan-head">
              <strong>From {formatDayLong(p.effectiveFrom)}</strong>
              {p === current ? <span className="pill sale-approved">In effect</span> : p.effectiveFrom > today ? <span className="pill pill-neutral">Scheduled</span> : <span className="pill sale-voided">Past</span>}
            </div>
            <div className="field-hint">{describe(p).join(' · ')} · Manager override {formatMoney(p.managerOverride)} per team vehicle</div>
          </li>
        ))}
      </ul>
      {!editing ? (
        <div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(true)}>New rates…</button></div>
      ) : (
        <form className="stack plan-form" onSubmit={onSubmit}>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="plan-from">Starts on</label>
              <input id="plan-from" type="date" min={today} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              <p className="field-hint">Applies to sales approved from this date.</p>
            </div>
            <div className="field">
              <label htmlFor="plan-override">Manager override per team vehicle (USD)</label>
              <input id="plan-override" inputMode="decimal" value={override} onChange={(e) => setOverride(e.target.value)} />
            </div>
          </div>
          <fieldset className="tier-rows">
            <legend className="field-label">Tiers (unit number in the month → perk per vehicle)</legend>
            {tiers.map((t, i) => (
              <div key={i} className="tier-row">
                <label>
                  From unit
                  <input inputMode="numeric" value={t.fromUnit} disabled={i === 0} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, fromUnit: e.target.value } : x)))} />
                </label>
                <label>
                  Perk (USD)
                  <input inputMode="decimal" value={t.perVehicle} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, perVehicle: e.target.value } : x)))} />
                </label>
                {i > 0 && <button type="button" className="link-danger" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>Remove</button>}
              </div>
            ))}
            {tiers.length < 10 && (
              <button type="button" className="account-link" onClick={() => setTiers([...tiers, { fromUnit: '', perVehicle: '' }])}>+ Add tier</button>
            )}
          </fieldset>
          {error && <div className="alert-error" role="alert">{error}</div>}
          <div className="form-actions">
            <button type="submit" className="button" disabled={saving}>{saving ? 'Saving…' : 'Save new rates'}</button>
            <button type="button" className="button button-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}

function Staff({ staff, onSaved }: { staff: StaffMember[]; onSaved: () => void }) {
  const managers = staff.filter((s) => s.role === 'manager' && s.isActive);
  return (
    <section className="panel" aria-labelledby="staff-title">
      <h2 className="panel-title" id="staff-title">Salaries and teams</h2>
      <p className="field-hint">Base salary is annual and paid bi-weekly (÷ 26). A new salary applies from the first pay period starting on or after its date.</p>
      <div className="table-wrap table-cards-wrap">
        <table className="table-cards">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>Manager</th>
              <th className="num">Annual salary</th>
              <th>Change salary</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <StaffRow key={s.id} person={s} managers={managers} onSaved={onSaved} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StaffRow({ person: p, managers, onSaved }: { person: StaffMember; managers: StaffMember[]; onSaved: () => void }) {
  const [salary, setSalaryValue] = useState('');
  const [from, setFrom] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setSalaryValue('');
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.fields)[0] ?? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className={p.isActive ? undefined : 'inactive'}>
      <td className="cell-title">{p.username}{!p.isActive && <span className="muted"> (deactivated)</span>}</td>
      <td data-label="Role">{p.role === 'manager' ? 'Manager' : p.role === 'sales' ? 'Sales rep' : 'Admin'}</td>
      <td data-label="Manager">
        {p.role === 'sales' ? (
          <select
            aria-label={`Manager of ${p.username}`}
            value={p.manager?.id ?? ''}
            disabled={busy}
            onChange={(e) => void save(() => setManager(p.id, e.target.value || null))}
          >
            <option value="">No manager</option>
            {managers.map((m) => <option key={m.id} value={m.id}>{m.username}</option>)}
          </select>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td data-label="Annual salary" className="num">
        {p.annualSalary === null ? <span className="muted">Not set</span> : formatMoney(p.annualSalary)}
        {p.salaryFrom && <div className="field-hint">from {formatDayLong(p.salaryFrom)}</div>}
      </td>
      <td data-label="Change salary">
        <form
          className="salary-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!(Number(salary) >= 0) || salary.trim() === '') {
              setError('Enter an annual amount');
              return;
            }
            void save(() => setSalary(p.id, Number(salary), from));
          }}
        >
          <input aria-label={`New annual salary for ${p.username}`} inputMode="decimal" placeholder="e.g. 32000" value={salary} onChange={(e) => setSalaryValue(e.target.value)} />
          <input aria-label="Starting" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <button type="submit" className="button button-secondary" disabled={busy}>Set</button>
        </form>
        {error && <p className="field-error" role="alert">{error}</p>}
      </td>
    </tr>
  );
}
