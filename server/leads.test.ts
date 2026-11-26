import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeMobile, validateLead, validateLeadEmail, validateStaffContact } from '../src/leadValidation.ts';
import { canCountAsFollowUp, emailSignature, emailThrottle, formatStaffMobile, senderName } from './leadEmails.ts';
import { fromAddress } from './notify.ts';
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
    emails: [],
    canEmail: false,
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

describe('staff contact details', () => {
  it('normalizes email and mobile, and allows clearing both', () => {
    assert.deepEqual(validateStaffContact(' Test.Rep01@OneStopVehicleShop.EXAMPLE ', '(213) 555-0106'), {
      ok: true,
      value: { email: 'test.rep01@onestopvehicleshop.example', mobile: '2135550106' },
    });
    assert.deepEqual(validateStaffContact('', ''), { ok: true, value: { email: null, mobile: null } });
    assert.deepEqual(validateStaffContact(null, undefined), { ok: true, value: { email: null, mobile: null } });
  });

  it('rejects a bad email or mobile', () => {
    const r = validateStaffContact('not-an-email', '12345');
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(!r.ok ? r.errors : {}).sort(), ['email', 'mobile']);
    assert.equal(validateStaffContact(42, null).ok, false);
  });
});

describe('emails to customers', () => {
  it('validates subject and body, and keeps the subject on one line', () => {
    assert.deepEqual(validateLeadEmail(' Your\r\nenquiry ', '  Hi Ada,\r\nThanks.  '), {
      ok: true,
      value: { subject: 'Your enquiry', body: 'Hi Ada,\nThanks.' },
    });
    const empty = validateLeadEmail('  ', '');
    assert.equal(empty.ok, false);
    assert.deepEqual(Object.keys(!empty.ok ? empty.errors : {}).sort(), ['body', 'subject']);
    assert.equal(validateLeadEmail('x'.repeat(151), 'Hi').ok, false);
    assert.equal(validateLeadEmail('Hi', 'x'.repeat(5001)).ok, false);
  });

  it('signs with the sender and formats US mobiles', () => {
    assert.equal(formatStaffMobile('2135550106'), '(213) 555-0106');
    assert.equal(formatStaffMobile('+12135550106'), '(213) 555-0106');
    assert.equal(formatStaffMobile('+447700900123'), '+447700900123');
    assert.equal(
      emailSignature({ username: 'test.rep01', email: 'rep@d.example', mobile: '2135550106' }),
      '--\ntest.rep01\nOne-Stop Vehicle Shop\nrep@d.example\nMobile: (213) 555-0106',
    );
    assert.doesNotMatch(emailSignature({ username: 'a', email: 'a@d.example', mobile: null }), /Mobile/);
    assert.equal(senderName('jsmith'), 'jsmith · One-Stop Vehicle Shop');
  });

  it('takes the address out of SMTP_FROM', () => {
    assert.equal(fromAddress('One-Stop Vehicle Shop <no-reply@d.example>'), 'no-reply@d.example');
    assert.equal(fromAddress('sales@d.example'), 'sales@d.example');
  });

  it('counts as a follow-up only on an open, assigned lead with follow-ups left', () => {
    const rep = { id: '6', username: 'test.rep01' };
    assert.equal(canCountAsFollowUp({ status: 'Assigned', assignedTo: rep, followUps: 0 }), true);
    assert.equal(canCountAsFollowUp({ status: 'SecondFollowUp', assignedTo: rep, followUps: 2 }), true);
    assert.equal(canCountAsFollowUp({ status: 'ThirdFollowUp', assignedTo: rep, followUps: 3 }), false);
    assert.equal(canCountAsFollowUp({ status: 'New', assignedTo: null, followUps: 0 }), false);
    assert.equal(canCountAsFollowUp({ status: 'Won', assignedTo: rep, followUps: 1 }), false);
  });

  it('limits each sender to 30 emails an hour', () => {
    const user = `test-${Math.random()}`;
    const now = Date.now();
    for (let i = 0; i < 30; i++) assert.equal(emailThrottle(user, now), 0);
    assert.equal(emailThrottle(user, now), 60);
    assert.equal(emailThrottle(user, now + 60 * 60 * 1000 + 1), 0);
  });
});
