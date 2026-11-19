// Lead (customer enquiry) validation shared by the lead form (src/), the API and the chat agent's
// create_lead tool (server/), so all three enforce the same rules.
// Imports use the `.ts` extension because Node runs this file directly on the server.
import {
  CONDITIONS,
  CONTACT_METHODS,
  LEAD_MESSAGE_MAX_LENGTH,
  MAX_URGENCY_DAYS,
  type Condition,
  type ContactMethod,
} from './types.ts';

export interface LeadInput {
  firstName: string;
  lastName: string;
  /** Lower-cased. */
  email: string;
  /** Digits only, with a leading "+" when the customer typed an international number. */
  mobile: string;
  preferredContact: ContactMethod;
  /** New, Used or Certified. */
  interestCondition: Condition;
  /** Within how many days the customer wants to buy (1-365). */
  urgencyDays: number;
  vehicleId: string | null;
  message: string | null;
  /** The customer agreed to be contacted by text/phone. Required when they prefer Text or Phone. */
  consent: boolean;
}

export type LeadFieldErrors = Partial<Record<keyof LeadInput, string>>;

export type LeadValidation = { ok: true; value: LeadInput } | { ok: false; errors: LeadFieldErrors };

export const NAME_MAX_LENGTH = 50;
export const EMAIL_MAX_LENGTH = 254;

// Letters (any script), spaces, apostrophes, hyphens and periods: "Mary-Jane", "O'Neil", "José", "Jr.".
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} '.-]*$/u;
// Deliberately simple: one @, no spaces, a dot in the domain. The real check is the sales team replying.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^\+?[\d\s().-]+$/;

/** "+1 (555) 123-4567" → "+15551234567"; null when it isn't a plausible phone number (10-15 digits). */
export function normalizeMobile(raw: string): string | null {
  const trimmed = raw.trim();
  if (!PHONE_CHARS.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return (trimmed.startsWith('+') ? '+' : '') + digits;
}

export function validateLead(raw: unknown): LeadValidation {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: LeadFieldErrors = {};
  const text = (key: keyof LeadInput) => (typeof input[key] === 'string' ? (input[key] as string).trim() : '');

  const name = (key: 'firstName' | 'lastName', label: string) => {
    const value = text(key).replace(/\s+/g, ' ');
    if (!value) errors[key] = `${label} is required`;
    else if (value.length > NAME_MAX_LENGTH) errors[key] = `${label} must be ${NAME_MAX_LENGTH} characters or fewer`;
    else if (!NAME.test(value)) errors[key] = `${label} can only contain letters, spaces, apostrophes, hyphens and periods`;
    return value;
  };
  const firstName = name('firstName', 'First name');
  const lastName = name('lastName', 'Last name');

  const email = text('email').toLowerCase();
  if (!email) errors.email = 'Email address is required';
  else if (email.length > EMAIL_MAX_LENGTH || !EMAIL.test(email)) errors.email = 'Enter a valid email address, like name@example.com';

  const rawMobile = text('mobile');
  const mobile = normalizeMobile(rawMobile);
  if (!rawMobile) errors.mobile = 'Mobile number is required';
  else if (!mobile) errors.mobile = 'Enter a mobile number with 10 to 15 digits';

  const preferredContact = input.preferredContact as ContactMethod;
  if (!(CONTACT_METHODS as readonly unknown[]).includes(preferredContact)) {
    errors.preferredContact = 'Choose how you would like us to contact you';
  }

  const interestCondition = input.interestCondition as Condition;
  if (!(CONDITIONS as readonly unknown[]).includes(interestCondition)) {
    errors.interestCondition = 'Choose new, used or certified pre-owned';
  }

  const urgencyDays = typeof input.urgencyDays === 'string' && input.urgencyDays.trim() ? Number(input.urgencyDays) : input.urgencyDays;
  if (typeof urgencyDays !== 'number' || !Number.isFinite(urgencyDays)) errors.urgencyDays = 'Tell us how soon you need a vehicle';
  else if (!Number.isInteger(urgencyDays) || urgencyDays < 1 || urgencyDays > MAX_URGENCY_DAYS) {
    errors.urgencyDays = `Enter a whole number of days between 1 and ${MAX_URGENCY_DAYS}`;
  }

  let vehicleId: string | null = null;
  if (input.vehicleId !== undefined && input.vehicleId !== null && input.vehicleId !== '') {
    const id = Number(input.vehicleId);
    if (!Number.isInteger(id) || id < 1 || id > 2_147_483_647) errors.vehicleId = 'Unknown vehicle';
    else vehicleId = String(id);
  }

  const message = text('message');
  if (input.message !== undefined && input.message !== null && typeof input.message !== 'string') errors.message = 'Message must be text';
  else if (message.length > LEAD_MESSAGE_MAX_LENGTH) errors.message = `Keep your message under ${LEAD_MESSAGE_MAX_LENGTH} characters`;

  const consent = input.consent === true;
  if (!consent && (preferredContact === 'Text' || preferredContact === 'Phone')) {
    errors.consent = preferredContact === 'Text' ? 'Please agree to receive text messages from us' : 'Please agree to receive phone calls from us';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      firstName,
      lastName,
      email,
      mobile: mobile!,
      preferredContact,
      interestCondition,
      urgencyDays: urgencyDays as number,
      vehicleId,
      message: message || null,
      consent,
    },
  };
}
