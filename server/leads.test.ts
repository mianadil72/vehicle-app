import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMobile, validateLead } from '../src/leadValidation.ts';
import { leadReference, type Lead } from '../src/types.ts';
import { firstFollowUpDue, followUpProblem, followUpStatus, isOverdue, leadThrottle, nextFollowUpDue } from './leads.ts';
import { headerSafe, leadEmail, leadSms, returningLines } from './notify.ts';

// Unit tests for the CRM module. Pure functions only: no database or SMTP. Run with `npm test`.

const VALID = {
  firstName: '  Mary-Jane ',
  lastName: "O'Neil",
  email: ' Mary.ONeil@Example.COM ',
  mobile: '+1 (555) 123-4567',
  preferredContact: 'Text',
  interestCondition: 'Certified',
  urgencyDays: 14,
  vehicleId: '42',
  message: '  Looking for AWD  ',
  consent: true,
};

describe('validateLead', () => {
  it('accepts a complete enquiry and normalizes it', () => {
    const r = validateLead(VALID);
    assert.ok(r.ok);
    assert.deepEqual(r.value, {
      firstName: 'Mary-Jane',
      lastName: "O'Neil",
      email: 'mary.oneil@example.com',
      mobile: '+15551234567',
      preferredContact: 'Text',
      interestCondition: 'Certified',
      urgencyDays: 14,
      vehicleId: '42',
      message: 'Looking for AWD',
      consent: true,
    });
  });

  it('reports every missing field', () => {
    const r = validateLead({});
    assert.ok(!r.ok);
    assert.deepEqual(Object.keys(r.errors).sort(), [
      'email', 'firstName', 'interestCondition', 'lastName', 'mobile', 'preferredContact', 'urgencyDays',
    ]);
  });

  it('rejects bad email, phone, urgency and names', () => {
    const r = validateLead({ ...VALID, email: 'not-an-email', mobile: '12345', urgencyDays: 400, firstName: '<script>' });
    assert.ok(!r.ok);
    assert.ok(r.errors.email && r.errors.mobile && r.errors.urgencyDays && r.errors.firstName);
    assert.ok(!validateLead({ ...VALID, urgencyDays: 2.5 }).ok);
    assert.ok(!validateLead({ ...VALID, urgencyDays: 0 }).ok);
  });

  it('accepts urgency given as a numeric string (form input)', () => {
    const r = validateLead({ ...VALID, urgencyDays: '30' });
    assert.ok(r.ok && r.value.urgencyDays === 30);
  });

  it('requires consent for text and phone, not for email', () => {
    const text = validateLead({ ...VALID, consent: false });
    assert.ok(!text.ok && text.errors.consent);
    const phone = validateLead({ ...VALID, preferredContact: 'Phone', consent: false });
    assert.ok(!phone.ok && phone.errors.consent);
    assert.ok(validateLead({ ...VALID, preferredContact: 'Email', consent: false }).ok);
  });

  it('treats an empty vehicle id and message as none', () => {
    const r = validateLead({ ...VALID, vehicleId: '', message: '   ' });
    assert.ok(r.ok && r.value.vehicleId === null && r.value.message === null);
    assert.ok(!validateLead({ ...VALID, vehicleId: 'abc' }).ok);
  });
});

describe('normalizeMobile', () => {
  it('keeps digits and a leading +', () => {
    assert.equal(normalizeMobile('555.123.4567'), '5551234567');
    assert.equal(normalizeMobile('+44 20 7946 0958'), '+442079460958');
    assert.equal(normalizeMobile('555-CALL-NOW'), null);
    assert.equal(normalizeMobile('1234567890123456'), null);
  });
});

describe('follow-up schedule', () => {
  const t0 = new Date('2026-11-19T15:00:00Z');

  it('maps follow-up numbers to statuses', () => {
    assert.equal(followUpStatus(1), 'FirstFollowUp');
    assert.equal(followUpStatus(2), 'SecondFollowUp');
    assert.equal(followUpStatus(3), 'ThirdFollowUp');
    assert.throws(() => followUpStatus(4), RangeError);
  });

  it('is due 2 days after the lead, then 2 days after each follow-up, none after the 3rd', () => {
    assert.equal(firstFollowUpDue(t0).toISOString(), '2026-11-21T15:00:00.000Z');
    assert.equal(nextFollowUpDue(t0, 1)?.toISOString(), '2026-11-21T15:00:00.000Z');
    assert.equal(nextFollowUpDue(t0, 2)?.toISOString(), '2026-11-21T15:00:00.000Z');
    assert.equal(nextFollowUpDue(t0, 3), null);
  });

  it('flags open leads past their due date only', () => {
    const due = '2026-11-21T15:00:00.000Z';
    const after = new Date('2026-11-21T15:00:01Z');
    assert.equal(isOverdue({ status: 'Assigned', nextFollowUpDue: due }, after), true);
    assert.equal(isOverdue({ status: 'Assigned', nextFollowUpDue: due }, t0), false);
    assert.equal(isOverdue({ status: 'Won', nextFollowUpDue: due }, after), false);
    assert.equal(isOverdue({ status: 'ThirdFollowUp', nextFollowUpDue: null }, after), false);
  });

  it('validates follow-up input', () => {
    assert.equal(followUpProblem('Phone', 'Left a voicemail'), null);
    assert.deepEqual(Object.keys(followUpProblem('Fax', ' ') ?? {}).sort(), ['method', 'note']);
  });
});

describe('leadThrottle', () => {
  it('allows 5 submissions per client per 15 minutes', () => {
    const key = `test-${Math.random()}`;
    const now = Date.now();
    for (let i = 0; i < 5; i++) assert.equal(leadThrottle(key, now), 0);
    assert.ok(leadThrottle(key, now) > 0);
    assert.equal(leadThrottle(key, now + 15 * 60 * 1000 + 1), 0);
  });
});

describe('manager notifications', () => {
  const lead: Lead = {
    id: '42',
    customerName: 'Ada Lovelace',
    preferredContact: 'Phone',
    interestCondition: 'Used',
    urgencyDays: 7,
    source: 'vehicle',
    status: 'New',
    assignedTo: null,
    followUps: 0,
    nextFollowUpDue: null,
    createdAt: '2026-11-19T15:00:00.000Z',
    customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', mobile: '+15551234567' },
    vehicle: { id: '7', title: '2022 Toyota Camry', price: 24500, stockNumber: 'T-1' },
    message: '<b>Hello</b>\r\nBcc: someone@example.com',
    assignedAt: null,
    closedAt: null,
    followUpList: [],
    notifications: [],
    returning: { customerSince: '2026-11-19T15:00:00.000Z', otherLeads: [], onFile: null },
  };

  it('adds nothing for a first-time customer', () => {
    assert.deepEqual(returningLines(lead), []);
    assert.doesNotMatch(leadEmail(lead, 'https://d.example').text, /Returning customer/);
  });

  it('notes a returning customer, and only the details that changed', () => {
    const earlier = [
      { id: '40', status: 'Lost' as const, createdAt: '2026-11-05T10:00:00.000Z' },
      { id: '12', status: 'Won' as const, createdAt: '2026-11-03T10:00:00.000Z' },
    ];
    const same = { ...lead, returning: { customerSince: '2026-11-03T10:00:00.000Z', otherLeads: earlier, onFile: null } };
    const sameLines = returningLines(same);
    assert.equal(sameLines.length, 1);
    assert.match(sameLines[0], /^Returning customer: 2 earlier enquiries, first contact Nov 3, 2026$/);

    const changed = {
      ...same,
      returning: {
        ...same.returning,
        onFile: { firstName: 'Ada', lastName: 'Lovelace', mobile: '+15550000000', preferredContact: 'Email' as const },
      },
    };
    const lines = returningLines(changed);
    assert.equal(lines.length, 2);
    assert.match(lines[1], /On file: +mobile \+15550000000, prefers Email$/);
    assert.match(leadEmail(changed, 'https://d.example').text, /Returning customer: 2 earlier enquiries/);
  });

  it('formats the reference', () => {
    assert.equal(leadReference(42), 'L-00042');
  });

  it('emails the details as plain text with links', () => {
    const { subject, text } = leadEmail(lead, 'https://dealer.example');
    assert.equal(subject, 'New lead L-00042: Ada Lovelace, Used, within 7 days');
    assert.match(text, /Mobile: +\+15551234567/);
    assert.match(text, /Preferred contact: Phone/);
    assert.match(text, /within 7 days/);
    assert.match(text, /\$24,500/);
    assert.match(text, /https:\/\/dealer\.example\/vehicles\/7/);
    assert.match(text, /https:\/\/dealer\.example\/leads\/42/);
    assert.ok(text.includes('<b>Hello</b>'), 'customer text is sent as-is, in a plain-text body');
  });

  it('keeps line breaks out of headers', () => {
    assert.equal(headerSafe('a\r\nBcc: x@example.com'), 'a Bcc: x@example.com');
    const { subject } = leadEmail({ ...lead, customer: { ...lead.customer, firstName: 'Ada\r\nBcc: x' } }, 'https://d.example');
    assert.ok(!/[\r\n]/.test(subject));
  });

  it('fits the text message in 160 characters, keeping the link', () => {
    const long = { ...lead, customer: { ...lead.customer, firstName: 'A'.repeat(50), lastName: 'B'.repeat(50) } };
    const { text } = leadSms(long, 'https://dealer.example');
    assert.ok(text.length <= 160, `${text.length} characters`);
    assert.ok(text.endsWith('https://dealer.example/leads/42'));
  });
});
