import nodemailer, { type Transporter } from 'nodemailer';
import { getPool, sql } from './db.ts';
import { getLead } from './leads.ts';
import { LEAD_STATUS_LABELS, leadReference, type Lead } from '../src/types.ts';

/**
 * Tells the lead sales manager about a new customer lead, by email (`LEAD_MANAGER_EMAIL`) and by text
 * (`LEAD_MANAGER_SMS`, an email-to-SMS gateway address such as 5551234567@vtext.com). The manager can
 * forward the email to the sales rep who is available; assigning the lead in the app tracks it.
 *
 * Sent over SMTP (`SMTP_HOST`, ...). Without SMTP_HOST the message is printed to the server console
 * and recorded as "Logged", so development works without a mail server. Every message is recorded in
 * dbo.LeadNotifications with its outcome. Messages are plain text: customer input is never sent as HTML.
 */

const env = process.env;
const DEFAULT_BASE_URL = 'http://localhost:5173';
const SMS_MAX_LENGTH = 160;

export const appBaseUrl = () => (env.APP_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

/** Header-safe: no line breaks (they would start a new mail header), trimmed to `max`. */
export const headerSafe = (s: string, max = 200) => s.replace(/[\r\n]+/g, ' ').trim().slice(0, max);

const formatUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const conditionLabel = (c: Lead['interestCondition']) => (c === 'Certified' ? 'certified pre-owned' : c.toLowerCase());

export interface OutgoingMessage {
  subject: string;
  text: string;
}

const longDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });

/** For a returning customer: how many earlier enquiries, and the details on file when they differ. */
export function returningLines(lead: Lead): string[] {
  const { otherLeads, customerSince, onFile } = lead.returning;
  if (otherLeads.length === 0) return [];
  const n = otherLeads.length;
  const lines = [
    `Returning customer: ${n} earlier enquir${n === 1 ? 'y' : 'ies'}, first contact ${longDate.format(new Date(customerSince))}`,
  ];
  if (onFile) {
    const changes = [
      (onFile.firstName !== lead.customer.firstName || onFile.lastName !== lead.customer.lastName) && `name ${onFile.firstName} ${onFile.lastName}`,
      onFile.mobile !== lead.customer.mobile && `mobile ${onFile.mobile}`,
      onFile.preferredContact !== lead.preferredContact && `prefers ${onFile.preferredContact}`,
    ].filter(Boolean);
    lines.push(`On file:           ${changes.join(', ')}`);
  }
  return lines;
}

/** The email to the lead sales manager. Plain text. */
export function leadEmail(lead: Lead, baseUrl = appBaseUrl()): OutgoingMessage {
  const ref = leadReference(lead.id);
  const name = `${lead.customer.firstName} ${lead.customer.lastName}`;
  const lines = [
    `New customer lead ${ref}`,
    '',
    `Customer:          ${name}`,
    `Email:             ${lead.customer.email}`,
    `Mobile:            ${lead.customer.mobile}`,
    `Preferred contact: ${lead.preferredContact}`,
    '',
    `Looking for:       a ${conditionLabel(lead.interestCondition)} vehicle`,
    `Wants to buy:      within ${days(lead.urgencyDays)}`,
  ];
  if (lead.vehicle) {
    lines.push(
      `Vehicle:           ${lead.vehicle.title}, ${formatUsd(lead.vehicle.price)} (Stock # ${lead.vehicle.stockNumber})`,
      `                   ${baseUrl}/vehicles/${lead.vehicle.id}`,
    );
  }
  lines.push(...returningLines(lead));
  lines.push(`Source:            ${lead.source === 'chat' ? 'online chat assistant' : lead.source === 'vehicle' ? 'vehicle page' : 'contact form'}`);
  if (lead.message) lines.push('', 'Message from the customer:', lead.message);
  lines.push(
    '',
    `Status: ${LEAD_STATUS_LABELS[lead.status]}. Forward this email to the sales rep who is available, and assign the lead to them in the app:`,
    `${baseUrl}/leads/${lead.id}`,
    '',
    'The 1st follow-up is due within 2 days, then every 2 days after the previous one (3 follow-ups).',
  );
  return {
    subject: headerSafe(`New lead ${ref}: ${name}, ${lead.interestCondition}, within ${days(lead.urgencyDays)}`),
    text: lines.join('\n'),
  };
}

/** The text message to the lead sales manager: at most 160 characters. */
export function leadSms(lead: Lead, baseUrl = appBaseUrl()): OutgoingMessage {
  const name = `${lead.customer.firstName} ${lead.customer.lastName}`;
  const link = `${baseUrl}/leads/${lead.id}`;
  const vehicle = lead.vehicle ? ` ${lead.vehicle.title}.` : '';
  const head = `New lead ${leadReference(lead.id)}: ${name}, ${lead.interestCondition}, ${days(lead.urgencyDays)}.${vehicle} ${lead.preferredContact} ${lead.customer.mobile}`;
  const room = SMS_MAX_LENGTH - link.length - 1;
  const text = `${head.length > room ? `${head.slice(0, room - 1)}…` : head} ${link}`;
  return { subject: 'New lead', text: text.slice(0, SMS_MAX_LENGTH) };
}

// --- Sending -----------------------------------------------------------------------------------

let transport: Transporter | undefined;
const smtp = () =>
  (transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === 'true', // true for port 465; otherwise STARTTLS when the server offers it
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } : undefined,
  }));

export const smtpConfigured = () => Boolean(env.SMTP_HOST);

interface Delivery {
  channel: 'email' | 'sms';
  to: string;
  message: OutgoingMessage;
  replyTo?: string;
}

async function deliver(leadId: number, d: Delivery): Promise<void> {
  const [mssql, pool] = await Promise.all([sql(), getPool()]);
  const { recordset } = await pool
    .request()
    .input('leadId', mssql.Int, leadId)
    .input('channel', mssql.VarChar(5), d.channel)
    .input('recipient', mssql.NVarChar(254), d.to.slice(0, 254))
    .input('subject', mssql.NVarChar(200), d.message.subject)
    .input('body', mssql.NVarChar(4000), d.message.text.slice(0, 4000))
    .query<{ NotificationId: number }>(`
      INSERT INTO dbo.LeadNotifications (LeadId, Channel, Recipient, Subject, Body)
        OUTPUT INSERTED.NotificationId
        VALUES (@leadId, @channel, @recipient, @subject, @body)`);
  const notificationId = recordset[0].NotificationId;

  let status: 'Sent' | 'Failed' | 'Logged';
  let error: string | null = null;
  if (!smtpConfigured()) {
    status = 'Logged';
    console.log(`[lead ${leadReference(leadId)}] SMTP_HOST not set; ${d.channel} to ${d.to} not sent:\n${d.message.subject}\n${d.message.text}\n`);
  } else {
    try {
      await smtp().sendMail({
        from: env.SMTP_FROM || env.SMTP_USER,
        to: d.to,
        replyTo: d.replyTo,
        subject: d.message.subject,
        text: d.message.text,
      });
      status = 'Sent';
    } catch (err) {
      status = 'Failed';
      error = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      console.error(`[lead ${leadReference(leadId)}] ${d.channel} to ${d.to} failed:`, error);
    }
  }
  await pool
    .request()
    .input('id', mssql.Int, notificationId)
    .input('status', mssql.VarChar(10), status)
    .input('error', mssql.NVarChar(500), error)
    .query(`UPDATE dbo.LeadNotifications
               SET Status = @status, Error = @error, SentAt = CASE WHEN @status = 'Sent' THEN SYSUTCDATETIME() END
             WHERE NotificationId = @id`);
}

/**
 * Emails and texts the lead sales manager about lead `leadId`. Never throws: the lead is already saved,
 * so a mail problem is recorded (and visible on the lead page, with "Resend") rather than lost.
 * Returns how many messages were attempted.
 */
export async function notifyNewLead(leadId: number): Promise<number> {
  try {
    const lead = await getLead(leadId, null);
    if (!lead) return 0;
    const deliveries: Delivery[] = [];
    if (env.LEAD_MANAGER_EMAIL) {
      deliveries.push({ channel: 'email', to: env.LEAD_MANAGER_EMAIL, message: leadEmail(lead), replyTo: lead.customer.email });
    }
    if (env.LEAD_MANAGER_SMS) deliveries.push({ channel: 'sms', to: env.LEAD_MANAGER_SMS, message: leadSms(lead) });
    if (deliveries.length === 0) {
      console.warn(`[lead ${leadReference(leadId)}] LEAD_MANAGER_EMAIL and LEAD_MANAGER_SMS are not set; nobody was notified.`);
      return 0;
    }
    for (const d of deliveries) await deliver(leadId, d);
    return deliveries.length;
  } catch (err) {
    console.error(`[lead ${leadReference(leadId)}] notification failed:`, err);
    return 0;
  }
}

export const notificationsConfigured = () => Boolean(env.LEAD_MANAGER_EMAIL || env.LEAD_MANAGER_SMS);
