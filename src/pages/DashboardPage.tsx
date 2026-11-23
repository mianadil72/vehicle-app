import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { fetchInventoryStats, fetchWeeklyStats, useRemote } from '../api';
import { useAuth } from '../auth';
import { RemoteStatus } from '../components/RemoteStatus';
import { formatDateTime, formatMileage, formatPrice } from '../format';
import type { NavState } from '../navigation';
import { CONDITIONS, type InventoryFigures } from '../types';

const number = new Intl.NumberFormat('en-US');
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });
const compactPrice = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

const orDash = <T,>(value: T | null, format: (v: T) => string) => (value === null ? '—' : format(value));
const yearOf = (avgYear: number | null) => orDash(avgYear, (y) => y.toFixed(1));
const ageOf = (avgYear: number | null) =>
  orDash(avgYear, (y) => `${Math.max(0, new Date().getFullYear() - y).toFixed(1)} yrs`);

/** Inventory counts by category, for admins and staff. Category rows link to the filtered inventory. */
export function DashboardPage() {
  const location = useLocation();
  const [refresh, setRefresh] = useState(0);
  const stats = useRemote(`inventory-stats-${refresh}`, (signal) => fetchInventoryStats(signal));
  const from = { from: location.pathname } satisfies NavState;
  // Sales team: vehicles sold this week (admins: dealership, managers: their team, reps: their own).
  const auth = useAuth();
  const salesScope = auth.isAdmin ? 'all' : auth.isLeadManager ? 'team' : 'me';
  const weekly = useRemote(auth.isSalesTeam ? `weekly-kpi-${salesScope}-${refresh}` : null, (signal) => fetchWeeklyStats(salesScope, 2, signal));
  const soldThisWeek = weekly.status === 'ready' ? weekly.data.totals[1] : null;
  const soldLastWeek = weekly.status === 'ready' ? weekly.data.totals[0] : null;

  return (
    <main className="dashboard">
      <header className="dashboard-head">
        <div>
          <h1>Inventory dashboard</h1>
          <p className="dashboard-sub">
            {stats.status === 'ready' ? `Updated ${formatDateTime(stats.data.generatedAt)}` : 'Vehicles for sale, by category'}
          </p>
        </div>
        <div className="dashboard-actions">
          <Link to="/" className="button button-secondary">Back to inventory</Link>
          <button type="button" className="button" onClick={() => setRefresh((n) => n + 1)} disabled={stats.status === 'loading'}>
            Refresh
          </button>
        </div>
      </header>

      <RemoteStatus remote={stats} what="inventory figures" />

      {stats.status === 'ready' && (() => {
        const { total, categories } = stats.data;
        const ranked = [...categories].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
        const max = Math.max(1, ...categories.map((c) => c.count));
        return (
          <>
            <section className="kpis" aria-label="Totals">
              <Kpi label="Vehicles in stock" value={number.format(total.count)} hero
                detail={CONDITIONS.map((c) => `${total.byCondition[c]} ${c.toLowerCase()}`).join(' · ')} />
              {soldThisWeek && soldLastWeek && (
                <Kpi
                  label={salesScope === 'all' ? 'Sold this week' : salesScope === 'team' ? 'Team sold this week' : 'You sold this week'}
                  value={number.format(soldThisWeek.units)}
                  detail={`${formatPrice(soldThisWeek.revenue)} · ${soldLastWeek.units} last week`}
                />
              )}
              <Kpi label="Inventory value" value={compactPrice.format(total.totalValue)} detail={formatPrice(total.totalValue)} />
              <Kpi label="Average price" value={orDash(total.avgPrice, formatPrice)} />
              <Kpi label="Average mileage" value={orDash(total.avgMileage, formatMileage)} />
              <Kpi label="Average age" value={ageOf(total.avgYear)} detail={`Model year ${yearOf(total.avgYear)}`} />
            </section>

            <section className="panel">
              <h2 className="panel-title">Vehicles by category</h2>
              {total.count === 0 ? (
                <p className="comments-empty">No vehicles in stock.</p>
              ) : (
                <ol className="bars">
                  {ranked.map((c) => (
                    <li key={c.category}>
                      <Link to={`/?cat=${encodeURIComponent(c.category)}`} className="bar-row" state={from}>
                        <span className="bar-label">{c.category}</span>
                        <span className="bar-track">
                          {c.count > 0 && <span className="bar" style={{ width: `${(c.count / max) * 100}%` }} />}
                          <span className="bar-value">
                            {c.count}
                            <span className="bar-share"> · {percent.format(c.count / total.count)}</span>
                          </span>
                        </span>
                        <span className="bar-tip" role="tooltip">
                          <strong>{c.category}: {c.count} vehicle{c.count === 1 ? '' : 's'}</strong>
                          {CONDITIONS.map((cond) => (
                            <span key={cond}>{cond}: {c.byCondition[cond]}</span>
                          ))}
                          <span>Value: {formatPrice(c.totalValue)}</span>
                          <span className="bar-tip-hint">Click to view in inventory</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="panel">
              <h2 className="panel-title">Breakdown by category</h2>
              <div className="table-wrap table-plain">
                <table>
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="num">Vehicles</th>
                      <th className="num">Share</th>
                      {CONDITIONS.map((c) => <th key={c} className="num">{c}</th>)}
                      <th className="num">Total value</th>
                      <th className="num">Avg price</th>
                      <th className="num">Avg mileage</th>
                      <th className="num">Avg model year</th>
                      <th className="num">Avg age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c) => (
                      <Row key={c.category} figures={c} share={total.count ? c.count / total.count : 0}
                        label={<Link to={`/?cat=${encodeURIComponent(c.category)}`} state={from} className="row-link">{c.category}</Link>} />
                    ))}
                  </tbody>
                  <tfoot>
                    <Row figures={total} share={total.count ? 1 : 0} label="All vehicles" />
                  </tfoot>
                </table>
              </div>
            </section>
          </>
        );
      })()}
    </main>
  );
}

function Kpi({ label, value, detail, hero }: { label: string; value: string; detail?: string; hero?: boolean }) {
  return (
    <div className={hero ? 'kpi kpi-hero' : 'kpi'}>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {detail && <p className="kpi-detail">{detail}</p>}
    </div>
  );
}

function Row({ figures: f, label, share }: { figures: InventoryFigures; label: ReactNode; share: number }) {
  return (
    <tr className={f.count === 0 ? 'row-empty' : undefined}>
      <td className="strong">{label}</td>
      <td className="num strong">{number.format(f.count)}</td>
      <td className="num">{percent.format(share)}</td>
      {CONDITIONS.map((c) => <td key={c} className="num">{f.byCondition[c]}</td>)}
      <td className="num">{formatPrice(f.totalValue)}</td>
      <td className="num">{orDash(f.avgPrice, formatPrice)}</td>
      <td className="num">{orDash(f.avgMileage, formatMileage)}</td>
      <td className="num">{yearOf(f.avgYear)}</td>
      <td className="num">{ageOf(f.avgYear)}</td>
    </tr>
  );
}
