const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat('en-US');

export const formatPrice = (n: number) => currency.format(n);

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "$1,153.85", "-$200.00": pay amounts, always with cents. */
export const formatMoney = (n: number) => money.format(n);

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const longDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Business dates ("2026-11-16", no time zone): "Nov 16" / "Nov 16, 2026". */
export const formatDay = (date: string) => shortDate.format(new Date(`${date}T00:00:00Z`));
export const formatDayLong = (date: string) => longDate.format(new Date(`${date}T00:00:00Z`));

/** "Nov 16 – Nov 29, 2026" for a pay period. */
export const formatPeriod = (start: string, end: string) => `${formatDay(start)} – ${formatDayLong(end)}`;
export const formatMileage = (n: number) => `${number.format(n)} mi`;

const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/** "Nov 10, 2026, 2:08 PM" in the viewer's time zone, from an ISO timestamp. */
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

const dateOnly = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

/** "Thu, Nov 19" in the viewer's time zone, from an ISO timestamp. */
export const formatDate = (iso: string) => dateOnly.format(new Date(iso));

/** "within 1 day", "within 30 days". */
export const formatUrgency = (days: number) => `within ${days} day${days === 1 ? '' : 's'}`;
