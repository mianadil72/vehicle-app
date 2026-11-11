import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ApiError, createVehicle, fetchVehicle, updateVehicle, useRemote } from '../api';
import { authErrorMessage, useAuth } from '../auth';
import { RemoteStatus } from '../components/RemoteStatus';
import { VehiclePhoto } from '../components/VehiclePhoto';
import type { NavState } from '../navigation';
import { formatMileage, formatPrice } from '../format';
import { CATEGORIES, CONDITIONS, type Category, type Condition, type Vehicle } from '../types';
import { LIMITS, validateVehicle, type FieldErrors, type VehicleInput } from '../validation';

type FieldKey = keyof VehicleInput;
/** Form state: every field as the text the user typed; photos are one URL per line. */
type Draft = Record<FieldKey, string>;

const THIS_YEAR = new Date().getFullYear();

const EMPTY: Draft = {
  name: '', model: '', year: String(THIS_YEAR), price: '', category: '', condition: '',
  mileage: '', color: '', colorHex: '#9aa3b2', stockNumber: '', photos: '',
};

const toDraft = (v: Vehicle): Draft => ({
  name: v.name, model: v.model, year: String(v.year), price: String(v.price), category: v.category,
  condition: v.condition, mileage: String(v.mileage), color: v.color, colorHex: v.colorHex,
  stockNumber: v.stockNumber, photos: (v.photos ?? []).join('\n'),
});

/** Blank → undefined (reported as "required"); allows "$31,995" and "28,410". */
const toNumber = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(/[$,\s]/g, '')));

const fromDraft = (d: Draft) => ({
  ...d,
  year: toNumber(d.year),
  price: toNumber(d.price),
  mileage: toNumber(d.mileage),
  photos: d.photos.split('\n'),
});

const FIELD_ORDER: FieldKey[] = ['name', 'model', 'year', 'category', 'condition', 'price', 'mileage', 'color', 'colorHex', 'stockNumber', 'photos'];

/** `/vehicles/new` (create) and `/vehicles/:id/edit` (edit). */
export function VehicleFormPage() {
  const { id } = useParams();
  const remote = useRemote(id ?? null, (signal) => fetchVehicle(id!, signal));
  const from = (useLocation().state as NavState | null)?.from;
  const inventory = from && from.startsWith('/') && !from.startsWith('/vehicles/') ? from : '/';

  if (id === undefined) return <VehicleForm initial={EMPTY} inventory={inventory} />;

  if (remote.status !== 'ready') {
    return (
      <>
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to={inventory}>← Back to inventory</Link>
        </nav>
        <RemoteStatus remote={remote} what="this vehicle" />
      </>
    );
  }
  if (!remote.data) {
    return (
      <div className="empty detail-missing">
        <h2>Vehicle not found</h2>
        <p>It may have been sold or removed from inventory.</p>
        <Link to="/" className="button">Browse inventory</Link>
      </div>
    );
  }
  return <VehicleForm key={remote.data.id} vehicle={remote.data} initial={toDraft(remote.data)} inventory={inventory} />;
}

function VehicleForm({ vehicle, initial, inventory }: { vehicle?: Vehicle; initial: Draft; inventory: string }) {
  const navigate = useNavigate();
  const auth = useAuth();
  const editing = vehicle !== undefined;
  const [draft, setDraft] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const title = editing ? `Edit ${vehicle.year} ${vehicle.name} ${vehicle.model}` : 'Add vehicle';
  const cancelTo = editing ? `/vehicles/${vehicle.id}` : inventory;

  useEffect(() => {
    document.title = `${title} | Vehicle Inventory`;
  }, [title]);

  // Errors show after the first submit attempt, then update live as fields are fixed.
  const check = validateVehicle(fromDraft(draft));
  const errors: FieldErrors = { ...(submitted && !check.ok ? check.errors : {}), ...serverErrors };

  const set = (key: FieldKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (serverErrors[key]) {
      setServerErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setFormError(null);
    if (!check.ok) {
      focusFirst(check.errors);
      return;
    }
    setSaving(true);
    try {
      const saved = editing ? await updateVehicle(vehicle.id, check.value) : await createVehicle(check.value);
      const state: NavState = {
        from: inventory,
        notice: editing ? 'Changes saved.' : `${saved.year} ${saved.name} ${saved.model} added to inventory.`,
      };
      // Replace the form in history, so Back from the saved vehicle doesn't reopen the form.
      navigate(`/vehicles/${saved.id}`, { replace: true, state });
    } catch (err) {
      setSaving(false);
      const authProblem = authErrorMessage(err);
      if (authProblem) {
        // Re-check the session: if it ended, RequireAdmin sends the user to sign in and back here.
        setFormError(authProblem);
        auth.refresh();
        return;
      }
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
        setServerErrors(err.fields);
        focusFirst(err.fields);
      } else if (err instanceof ApiError && err.status === 404) {
        setFormError('This vehicle no longer exists. It may have been deleted.');
      } else {
        setFormError("Couldn't save. Check that the API server and database are running, then try again.");
      }
    }
  };

  const field = (key: FieldKey) => ({
    id: key,
    name: key,
    value: draft[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${key}-error` : undefined,
  });

  // Live preview of the inventory card, using whatever has been entered so far.
  const year = toNumber(draft.year);
  const previewPhotos = draft.photos.split('\n').map((p) => p.trim()).filter((p) => /^(\/|https?:\/\/)\S+$/i.test(p));
  const preview: Vehicle | null = (CATEGORIES as readonly string[]).includes(draft.category)
    ? {
        id: vehicle?.id ?? 'new',
        name: draft.name.trim() || 'Name',
        model: draft.model.trim() || 'Model',
        year: year && Number.isFinite(year) ? year : THIS_YEAR,
        price: toNumber(draft.price) || 0,
        category: draft.category as Category,
        condition: ((CONDITIONS as readonly string[]).includes(draft.condition) ? draft.condition : 'New') as Condition,
        mileage: toNumber(draft.mileage) || 0,
        color: draft.color,
        colorHex: /^#[0-9a-f]{6}$/i.test(draft.colorHex) ? draft.colorHex : '#9aa3b2',
        stockNumber: draft.stockNumber,
        photos: previewPhotos,
      }
    : null;

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={cancelTo} state={editing ? { from: inventory } : undefined}>
          ← {editing ? 'Back to vehicle' : 'Back to inventory'}
        </Link>
      </nav>

      <div className="form-layout">
        <form className="vehicle-form" onSubmit={onSubmit} noValidate>
          <h1>{title}</h1>

          {formError && <div className="alert-error" role="alert">{formError}</div>}

          <fieldset disabled={saving}>
            <div className="form-grid">
              <Field id="name" label="Name (make)" error={errors.name}>
                <input {...field('name')} autoComplete="off" maxLength={50} placeholder="Toyota" />
              </Field>
              <Field id="model" label="Model" error={errors.model}>
                <input {...field('model')} autoComplete="off" maxLength={100} placeholder="Camry XSE" />
              </Field>
              <Field id="year" label="Year" error={errors.year}>
                <input {...field('year')} type="number" inputMode="numeric" min={LIMITS.minYear} max={LIMITS.maxYear()} step={1} />
              </Field>
              <Field id="category" label="Category" error={errors.category}>
                <select {...field('category')}>
                  <option value="" disabled>Choose…</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field id="condition" label="Condition" error={errors.condition}>
                <select {...field('condition')}>
                  <option value="" disabled>Choose…</option>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field id="price" label="Price (USD)" error={errors.price}>
                <input {...field('price')} inputMode="decimal" autoComplete="off" placeholder="31995" />
              </Field>
              <Field id="mileage" label="Mileage" error={errors.mileage}>
                <input {...field('mileage')} inputMode="numeric" autoComplete="off" placeholder="12" />
              </Field>
              <Field id="stockNumber" label="Stock #" error={errors.stockNumber}>
                <input {...field('stockNumber')} autoComplete="off" maxLength={20} placeholder="T24-1031" className="mono" />
              </Field>
              <Field id="color" label="Exterior color" error={errors.color}>
                <input {...field('color')} autoComplete="off" maxLength={50} placeholder="Celestial Silver" />
              </Field>
              <Field id="colorHex" label="Paint swatch" error={errors.colorHex}>
                <div className="color-field">
                  <input
                    type="color"
                    aria-label="Pick paint color"
                    value={/^#[0-9a-f]{6}$/i.test(draft.colorHex) ? draft.colorHex : '#9aa3b2'}
                    onChange={(e) => set('colorHex', e.target.value)}
                  />
                  <input {...field('colorHex')} autoComplete="off" maxLength={7} className="mono" />
                </div>
              </Field>
              <Field
                id="photos"
                label="Photo URLs"
                error={errors.photos}
                hint="Optional. One per line, cover photo first. Without photos, a placeholder illustration in the paint color is shown."
                wide
              >
                <textarea {...field('photos')} rows={3} placeholder={'/vehicles/1/front.jpg\nhttps://…'} spellCheck={false} />
              </Field>
            </div>
          </fieldset>

          <div className="form-actions">
            <button type="submit" className="button" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add vehicle'}
            </button>
            <Link to={cancelTo} state={editing ? { from: inventory } : undefined} className="button button-secondary">
              Cancel
            </Link>
          </div>
        </form>

        <aside className="form-preview" aria-label="Preview">
          <p className="form-preview-label">Preview</p>
          <div className="card">
            <div className="card-media">
              {preview ? (
                <VehiclePhoto vehicle={preview} className="card-image" />
              ) : (
                <div className="preview-empty">Choose a category to preview</div>
              )}
            </div>
            <div className="card-body">
              <p className="card-year">{preview?.year ?? draft.year}</p>
              <h3 className="card-title">
                {draft.name.trim() || 'Name'} <span>{draft.model.trim() || 'Model'}</span>
              </h3>
              <p className="card-price">{preview?.price ? formatPrice(preview.price) : '$—'}</p>
              <p className="card-year">
                {preview?.mileage ? formatMileage(preview.mileage) : '— mi'} · {draft.color.trim() || 'Color'}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

function Field(props: { id: FieldKey; label: string; error?: string; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={props.wide ? 'field field-wide' : 'field'}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.error ? (
        <p className="field-error" id={`${props.id}-error`}>{props.error}</p>
      ) : (
        props.hint && <p className="field-hint">{props.hint}</p>
      )}
    </div>
  );
}

function focusFirst(errors: FieldErrors) {
  const first = FIELD_ORDER.find((k) => errors[k]);
  if (first) requestAnimationFrame(() => document.getElementById(first)?.focus());
}
