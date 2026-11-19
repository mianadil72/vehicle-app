const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat('en-US');

export const formatPrice = (n: number) => currency.format(n);
export const formatMileage = (n: number) => `${number.format(n)} mi`;

const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/** "Nov 10, 2026, 2:08 PM" in the viewer's time zone, from an ISO timestamp. */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

const dateOnly = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** "Thu, Nov 19" in the viewer's time zone, from an ISO timestamp. */
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

/** "within 1 day", "within 30 days". */
export const formatUrgency = (days: number) => `within ${days} day${days === 1 ? '' : 's'}`;
