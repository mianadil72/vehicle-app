import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiError, fetchLead, fetchPerkEstimate, fetchVehicle, fetchVehicles, recordSale, useRemote } from '../api';
import { useAuth } from '../auth';
import { formatMoney, formatPrice } from '../format';
import type { NavState } from '../navigation';
import { leadReference, type Vehicle } from '../types';

type Field = 'vehicleId' | 'buyerName' | 'salePrice' | 'saleDate' | 'notes' | 'leadId';

/** Today as YYYY-MM-DD in the browser's time zone (the server checks against the dealership's). */
const localToday = () => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** `/sales/new?vehicle=<id>&lead=<id>`: record a sold vehicle; it waits for a manager's approval. */
export function RecordSalePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const leadId = params.get('lead');
  const preset = useRemote(`sale-preset-${params.get('vehicle') ?? ''}-${leadId ?? ''}`, async (signal) => {
    const lead = leadId ? await fetchLead(leadId, signal).catch(() => null) : null;
    const vehicleId = params.get('vehicle') ?? lead?.vehicle?.id ?? null;
    const vehicle = vehicleId ? await fetchVehicle(vehicleId, signal) : null;
    return { lead, vehicle };
  });

  useEffect(() => {
    document.title = 'Record a sale | ONE-STOP VEHICLE SHOP DEALERSHIP';
  }, []);

  if (preset.status !== 'ready') {
    return <div className="empty" role="status"><p>Loading…</p></div>;
  }
  return (
    <SaleForm
      key={`${preset.data.vehicle?.id ?? ''}-${preset.data.lead?.id ?? ''}`}
      initialVehicle={preset.data.vehicle}
      lead={preset.data.lead ? { id: preset.data.lead.id, name: preset.data.lead.customerName } : null}
      onSaved={(title) => navigate('/sales', { state: { notice: `Sale of the ${title} recorded. It's waiting for approval.` } satisfies NavState })}
      sellerName={auth.user?.username ?? ''}
    />
  );
}

function SaleForm(props: {
  initialVehicle: Vehicle | null;
  lead: { id: string; name: string } | null;
  onSaved: (title: string) => void;
  sellerName: string;
}) {
  const auth = useAuth();
  const [vehicle, setVehicle] = useState<Vehicle | null>(props.initialVehicle?.saleStatus ? null : props.initialVehicle);
  const [buyerName, setBuyerName] = useState(props.lead?.name ?? '');
  const [salePrice, setSalePrice] = useState(props.initialVehicle && !props.initialVehicle.saleStatus ? String(props.initialVehicle.price) : '');
  const [saleDate, setSaleDate] = useState(localToday());
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>(
    props.initialVehicle?.saleStatus ? { vehicleId: 'That vehicle already has a sale recorded. Choose another.' } : {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const estimate = useRemote(saleDate ? `estimate-${saleDate}` : null, (signal) => fetchPerkEstimate(saleDate, signal));

  const pick = (v: Vehicle) => {
    setVehicle(v);
    setSalePrice(String(v.price));
    setErrors((e) => ({ ...e, vehicleId: undefined }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const problems: Partial<Record<Field, string>> = {};
    if (!vehicle) problems.vehicleId = 'Choose the vehicle that was sold';
    if (!buyerName.trim()) problems.buyerName = "Enter the buyer's name";
    if (!salePrice.trim() || !(Number(salePrice) > 0)) problems.salePrice = 'Enter the sale price';
    if (!saleDate) problems.saleDate = 'Enter the date of the sale';
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;
    setSaving(true);
    try {
      await recordSale({ vehicleId: vehicle!.id, leadId: props.lead?.id ?? null, buyerName, salePrice, saleDate, notes });
      props.onSaved(`${vehicle!.year} ${vehicle!.name} ${vehicle!.model}`);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) auth.refresh();
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) setErrors(err.fields as Partial<Record<Field, string>>);
      else setFormError(err instanceof ApiError ? err.message : "Couldn't record the sale.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/sales">← Back to sales</Link>
      </nav>
      <form className="vehicle-form contact-page" onSubmit={onSubmit} noValidate>
        <h1>Record a sale</h1>
        <p className="login-sub">
          Sold by <strong>{props.sellerName}</strong>. {auth.user?.role === 'sales' ? 'Your manager' : 'An admin'} approves it; the perk is added to your pay then.
          {props.lead && <> Linked to lead <Link to={`/leads/${props.lead.id}`} className="mono">{leadReference(props.lead.id)}</Link>.</>}
        </p>
        {formError && <div className="alert-error" role="alert">{formError}</div>}
        <fieldset disabled={saving} className="stack">
          <VehiclePicker vehicle={vehicle} onPick={pick} onClear={() => setVehicle(null)} error={errors.vehicleId} />
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sale-buyer">Buyer's name</label>
              <input id="sale-buyer" value={buyerName} maxLength={100} autoComplete="off" autoCapitalize="words" onChange={(e) => setBuyerName(e.target.value)} aria-invalid={errors.buyerName ? true : undefined} />
              {errors.buyerName && <p className="field-error">{errors.buyerName}</p>}
            </div>
            <div className="field">
              <label htmlFor="sale-price">Sale price (USD)</label>
              <input id="sale-price" inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} aria-invalid={errors.salePrice ? true : undefined} />
              {errors.salePrice ? (
                <p className="field-error">{errors.salePrice}</p>
              ) : (
                vehicle && <p className="field-hint">List price {formatPrice(vehicle.price)}</p>
              )}
            </div>
            <div className="field">
              <label htmlFor="sale-date">Sale date</label>
              <input id="sale-date" type="date" value={saleDate} max={localToday()} onChange={(e) => setSaleDate(e.target.value)} aria-invalid={errors.saleDate ? true : undefined} />
              {errors.saleDate && <p className="field-error">{errors.saleDate}</p>}
            </div>
            <div className="field">
              <span className="field-label">Estimated perk</span>
              <p className="estimate" aria-live="polite">
                {estimate.status === 'ready' ? (
                  <>
                    <strong>{formatMoney(estimate.data.perk)}</strong>
                    <span className="field-hint"> {estimate.data.label}. Fixed when approved.</span>
                  </>
                ) : (
                  <span className="field-hint">…</span>
                )}
              </p>
            </div>
            <div className="field field-wide">
              <label htmlFor="sale-notes">Notes (optional)</label>
              <textarea id="sale-notes" rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className="lead-message" placeholder="Trade-in, financing, delivery date…" />
              {errors.notes && <p className="field-error">{errors.notes}</p>}
            </div>
          </div>
        </fieldset>
        <div className="form-actions">
          <button type="submit" className="button" disabled={saving}>{saving ? 'Saving…' : 'Submit for approval'}</button>
          <Link to="/sales" className="button button-secondary">Cancel</Link>
        </div>
      </form>
    </>
  );
}

/** Search the vehicles for sale by stock #, make, model or year. */
function VehiclePicker(props: { vehicle: Vehicle | null; onPick: (v: Vehicle) => void; onClear: () => void; error?: string }) {
  const [query, setQuery] = useState('');
  const all = useRemote(props.vehicle ? null : 'sale-vehicles', (signal) => fetchVehicles({}, signal));
  const matches = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0 || all.status !== 'ready') return [];
    return all.data
      .filter((v) => {
        const text = `${v.stockNumber} ${v.year} ${v.name} ${v.model} ${v.color}`.toLowerCase();
        return words.every((w) => text.includes(w));
      })
      .slice(0, 8);
  }, [query, all]);

  if (props.vehicle) {
    const v = props.vehicle;
    return (
      <div className="field">
        <span className="field-label">Vehicle</span>
        <div className="picked-vehicle">
          <div>
            <strong>{v.year} {v.name} {v.model}</strong>
            <div className="field-hint"><span className="mono">{v.stockNumber}</span> · {v.condition} · {formatPrice(v.price)}</div>
          </div>
          <button type="button" className="button button-secondary" onClick={props.onClear}>Change</button>
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor="sale-vehicle">Vehicle</label>
      <input
        id="sale-vehicle"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        placeholder="Stock #, make, model or year"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-invalid={props.error ? true : undefined}
        aria-describedby="sale-vehicle-hint"
      />
      {props.error ? (
        <p className="field-error" id="sale-vehicle-hint">{props.error}</p>
      ) : (
        <p className="field-hint" id="sale-vehicle-hint">Only vehicles for sale are listed.</p>
      )}
      {matches.length > 0 && (
        <ul className="vehicle-options" aria-label="Matching vehicles">
          {matches.map((v) => (
            <li key={v.id}>
              <button type="button" className="vehicle-option" onClick={() => props.onPick(v)}>
                <span><strong>{v.year} {v.name} {v.model}</strong> <span className="muted">{v.color}</span></span>
                <span className="mono">{v.stockNumber} · {formatPrice(v.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && all.status === 'ready' && matches.length === 0 && <p className="field-hint">No vehicles for sale match “{query.trim()}”.</p>}
    </div>
  );
}
