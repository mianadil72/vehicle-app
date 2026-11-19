import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, submitLead } from '../api';
import { validateLead, type LeadFieldErrors, type LeadInput } from '../leadValidation';
import { CONDITIONS, CONTACT_METHODS, LEAD_MESSAGE_MAX_LENGTH, MAX_URGENCY_DAYS, type Condition, type ContactMethod } from '../types';

const URGENCY_PICKS = [7, 14, 30, 60, 90];
const FIELD_ORDER: (keyof LeadInput)[] = [
  'firstName', 'lastName', 'email', 'mobile', 'preferredContact', 'interestCondition', 'urgencyDays', 'message', 'consent',
];

const CONDITION_LABELS: Record<Condition, string> = { New: 'New', Used: 'Used', Certified: 'Certified pre-owned' };
const CONTACT_LABELS: Record<ContactMethod, string> = { Email: 'Email', Text: 'Text message', Phone: 'Phone call' };

interface Draft {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  preferredContact: ContactMethod | '';
  interestCondition: Condition | '';
  urgencyDays: string;
  message: string;
  consent: boolean;
}

/**
 * Customer enquiry form: contact details, preferred contact method, new/used/certified, and how soon
 * they want to buy. Used on `/contact` and in "I'm interested" on a vehicle page. Validated with the
 * same rules as the API (`validateLead`).
 */
export function LeadForm(props: {
  source: 'contact' | 'vehicle';
  vehicle?: { id: string; title: string; condition: Condition };
  heading?: ReactNode;
}) {
  const uid = useId();
  const [draft, setDraft] = useState<Draft>({
    firstName: '',
    lastName: '',
    email: '',
    mobile: '',
    preferredContact: '',
    interestCondition: props.vehicle?.condition ?? '',
    urgencyDays: '',
    message: '',
    consent: false,
  });
  const [website, setWebsite] = useState(''); // honeypot: hidden from people, bots fill it in
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key as keyof LeadInput]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const id = (key: keyof LeadInput) => `${uid}-${key}`;
  const describedBy = (key: keyof LeadInput) => (errors[key] ? `${id(key)}-error` : undefined);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const check = validateLead({
      ...draft,
      urgencyDays: draft.urgencyDays.trim() === '' ? undefined : Number(draft.urgencyDays),
      vehicleId: props.vehicle?.id ?? null,
    });
    if (!check.ok) {
      setErrors(check.errors);
      focusFirst(check.errors, id);
      return;
    }
    setSaving(true);
    try {
      setReference(await submitLead(check.value, props.source, website));
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
        setErrors(err.fields as LeadFieldErrors);
        focusFirst(err.fields as LeadFieldErrors, id);
      } else {
        setFormError(err instanceof ApiError ? err.message : "We couldn't send your details. Please try again, or call the dealership.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (reference) {
    return (
      <div className="lead-done" role="status">
        <h2>Thanks, {draft.firstName.trim()}!</h2>
        <p>
          Your request <strong className="mono">{reference}</strong> is with our sales team. A salesperson will contact you by{' '}
          {draft.preferredContact === 'Email' ? 'email' : draft.preferredContact === 'Text' ? 'text message' : 'phone'} soon.
        </p>
      </div>
    );
  }

  const fieldProps = (key: 'firstName' | 'lastName' | 'email' | 'mobile') => ({
    id: id(key),
    value: draft[key],
    onChange: (e: { target: { value: string } }) => set(key, e.target.value),
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': describedBy(key),
  });

  const consentText =
    draft.preferredContact === 'Text'
      ? 'I agree to receive text messages from the dealership about this request. Message and data rates may apply.'
      : draft.preferredContact === 'Phone'
        ? 'I agree to receive phone calls from the dealership about this request.'
        : 'I agree to be contacted by the dealership about this request.';

  return (
    <form className="vehicle-form lead-form" onSubmit={onSubmit} noValidate>
      {props.heading}
      {props.vehicle && (
        <p className="field-hint">
          About: <strong>{props.vehicle.title}</strong>
        </p>
      )}
      {formError && <div className="alert-error" role="alert">{formError}</div>}
      <fieldset disabled={saving}>
        <div className="form-grid">
          <Field id={id('firstName')} label="First name" error={errors.firstName}>
            <input {...fieldProps('firstName')} autoComplete="given-name" maxLength={50} />
          </Field>
          <Field id={id('lastName')} label="Last name" error={errors.lastName}>
            <input {...fieldProps('lastName')} autoComplete="family-name" maxLength={50} />
          </Field>
          <Field id={id('email')} label="Email address" error={errors.email}>
            <input {...fieldProps('email')} type="email" autoComplete="email" maxLength={254} inputMode="email" />
          </Field>
          <Field id={id('mobile')} label="Mobile number" error={errors.mobile}>
            <input {...fieldProps('mobile')} type="tel" autoComplete="tel" maxLength={25} placeholder="(555) 123-4567" />
          </Field>

          <ChoiceGroup
            id={id('preferredContact')}
            legend="How should we contact you?"
            options={CONTACT_METHODS.map((m) => [m, CONTACT_LABELS[m]])}
            value={draft.preferredContact}
            onChange={(v) => set('preferredContact', v as ContactMethod)}
            error={errors.preferredContact}
          />
          <ChoiceGroup
            id={id('interestCondition')}
            legend="Are you looking for a vehicle that is"
            options={CONDITIONS.map((c) => [c, CONDITION_LABELS[c]])}
            value={draft.interestCondition}
            onChange={(v) => set('interestCondition', v as Condition)}
            error={errors.interestCondition}
          />

          <div className="field field-wide">
            <label htmlFor={id('urgencyDays')}>How soon do you want to buy? (days)</label>
            <div className="urgency-row">
              <input
                id={id('urgencyDays')}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_URGENCY_DAYS}
                step={1}
                value={draft.urgencyDays}
                onChange={(e) => set('urgencyDays', e.target.value)}
                aria-invalid={errors.urgencyDays ? true : undefined}
                aria-describedby={describedBy('urgencyDays') ?? `${id('urgencyDays')}-hint`}
                className="urgency-input"
              />
              <div className="chip-row" role="group" aria-label="Quick picks">
                {URGENCY_PICKS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={draft.urgencyDays === String(n) ? 'chip active' : 'chip'}
                    aria-pressed={draft.urgencyDays === String(n)}
                    onClick={() => set('urgencyDays', String(n))}
                  >
                    {n} days
                  </button>
                ))}
              </div>
            </div>
            {errors.urgencyDays ? (
              <p className="field-error" id={`${id('urgencyDays')}-error`}>{errors.urgencyDays}</p>
            ) : (
              <p className="field-hint" id={`${id('urgencyDays')}-hint`}>Within how many days you'd like to have your vehicle (1–{MAX_URGENCY_DAYS}).</p>
            )}
          </div>

          <Field id={id('message')} label="Anything else? (optional)" error={errors.message} wide>
            <textarea
              id={id('message')}
              rows={3}
              maxLength={LEAD_MESSAGE_MAX_LENGTH}
              value={draft.message}
              onChange={(e) => set('message', e.target.value)}
              aria-invalid={errors.message ? true : undefined}
              aria-describedby={describedBy('message')}
              className="lead-message"
            />
          </Field>

          <div className="field field-wide">
            <label className="check">
              <input
                id={id('consent')}
                type="checkbox"
                checked={draft.consent}
                onChange={(e) => set('consent', e.target.checked)}
                aria-invalid={errors.consent ? true : undefined}
                aria-describedby={describedBy('consent')}
              />
              <span>{consentText}</span>
            </label>
            {errors.consent && <p className="field-error" id={`${id('consent')}-error`}>{errors.consent}</p>}
          </div>
        </div>

        <div className="visually-hidden" aria-hidden="true">
          <label htmlFor={`${uid}-website`}>Leave this empty</label>
          <input id={`${uid}-website`} name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
      </fieldset>
      <div className="form-actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Sending…' : 'Have a salesperson contact me'}
        </button>
      </div>
    </form>
  );
}

function Field(props: { id: string; label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={props.wide ? 'field field-wide' : 'field'}>
      <label htmlFor={props.id}>{props.label}</label>
      {props.children}
      {props.error && <p className="field-error" id={`${props.id}-error`}>{props.error}</p>}
    </div>
  );
}

/** Radio buttons styled as segmented choices. The group's id is put on the first radio, for focusing on errors. */
function ChoiceGroup(props: {
  id: string;
  legend: string;
  options: [string, string][];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <fieldset className="field field-wide choice-group" aria-describedby={props.error ? `${props.id}-error` : undefined}>
      <legend>{props.legend}</legend>
      <div className="choices">
        {props.options.map(([value, label], i) => (
          <label key={value} className={props.value === value ? 'choice active' : 'choice'}>
            <input
              type="radio"
              id={i === 0 ? props.id : undefined}
              name={props.id}
              value={value}
              checked={props.value === value}
              onChange={() => props.onChange(value)}
              aria-invalid={props.error ? true : undefined}
            />
            {label}
          </label>
        ))}
      </div>
      {props.error && <p className="field-error" id={`${props.id}-error`}>{props.error}</p>}
    </fieldset>
  );
}

function focusFirst(errors: LeadFieldErrors, id: (key: keyof LeadInput) => string) {
  const first = FIELD_ORDER.find((k) => errors[k]);
  if (first) requestAnimationFrame(() => document.getElementById(id(first))?.focus());
}
