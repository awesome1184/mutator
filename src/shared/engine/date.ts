// Daily puzzles roll over at 00:00 UTC for everyone, everywhere.

export const EPOCH_DATE = '2026-01-01';
const DAY_MS = 86_400_000;

export function todayKey(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function isDateKey(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function dateToMs(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

export function addDays(dateKey: string, days: number): string {
  return new Date(dateToMs(dateKey) + days * DAY_MS).toISOString().slice(0, 10);
}

export function dayDiff(a: string, b: string): number {
  return Math.round((dateToMs(b) - dateToMs(a)) / DAY_MS);
}

export function challengeNumber(dateKey: string): number {
  return Math.max(1, dayDiff(EPOCH_DATE, dateKey) + 1);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(dateKey: string): number {
  return new Date(dateToMs(dateKey)).getUTCDay();
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function weekdayName(dateKey: string): string {
  return WEEKDAYS[weekdayOf(dateKey)] ?? '';
}

export function prettyDate(dateKey: string): string {
  const d = new Date(dateToMs(dateKey));
  return `${WEEKDAYS[d.getUTCDay()]?.slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function msUntilNextDay(now: number = Date.now()): number {
  const next = dateToMs(todayKey(now)) + DAY_MS;
  return next - now;
}

export function padNumber(n: number): string {
  return String(Math.max(1, n)).padStart(3, '0');
}
