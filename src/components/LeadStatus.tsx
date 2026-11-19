import { formatDate } from '../format';
import { CLOSED_LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadSummary } from '../types';

/** Same rule as `isOverdue` in server/leads.ts: an open lead whose next follow-up is past due. */
const overdue = (lead: Pick<LeadSummary, 'status' | 'nextFollowUpDue'>) =>
  !CLOSED_LEAD_STATUSES.includes(lead.status) && lead.nextFollowUpDue !== null && new Date(lead.nextFollowUpDue).getTime() < Date.now();

export function LeadStatusPill({ status }: { status: LeadSummary['status'] }) {
  return <span className={`pill lead-status lead-status-${status.toLowerCase()}`}>{LEAD_STATUS_LABELS[status]}</span>;
}

/** When the next follow-up is due, flagged when overdue. */
export function NextDue({ lead }: { lead: Pick<LeadSummary, 'status' | 'nextFollowUpDue' | 'assignedTo'> }) {
  if (CLOSED_LEAD_STATUSES.includes(lead.status)) return <span className="muted">Closed</span>;
  if (!lead.assignedTo) return <span className="muted">Assign first</span>;
  if (!lead.nextFollowUpDue) return <span className="muted">All 3 done</span>;
  return (
    <span className="next-due">
      <time dateTime={lead.nextFollowUpDue}>{formatDate(lead.nextFollowUpDue)}</time>
      {overdue(lead) && <span className="pill pill-overdue">Overdue</span>}
    </span>
  );
}
