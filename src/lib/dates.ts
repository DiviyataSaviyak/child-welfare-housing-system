const TIME_ZONE = "Asia/Colombo";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Formats a date the way Sri Lankan offices write it: YYYY.MM.DD, in Colombo time (UI-3, ARC-6).
 * A plain "YYYY-MM-DD" string is treated as that calendar day, whatever the server's time zone.
 */
export function formatDate(value: Date | string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", ".");

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError(`Not a valid date: ${String(value)}`);

  return colomboDay(date).replaceAll("-", ".");
}

/** The calendar day in Colombo (ARC-6) as "YYYY-MM-DD". */
export function colomboDay(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("Not a valid date");
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.formatToParts(date).find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** The year in Colombo, as used in case numbers (CASE-5). */
export function colomboYear(date: Date): number {
  return Number(colomboDay(date).slice(0, 4));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole calendar days in Colombo from `from` to `to`: 0 on the same day, 1 on the next day. */
export function daysBetween(from: Date, to: Date): number {
  const day = (date: Date) => Date.parse(`${colomboDay(date)}T00:00:00Z`);
  return Math.round((day(to) - day(from)) / DAY_MS);
}

/**
 * A calendar day typed into a form, such as a release date: "YYYY-MM-DD" when it is a real day,
 * otherwise null. Days compare correctly as strings.
 */
export function parseDay(text: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
}

/** A calendar day as a date-only database column stores it: midnight UTC. */
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** A date-only database column's value as "YYYY-MM-DD". */
export function dateToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The calendar day `count` days after `day` ("YYYY-MM-DD"), or before it when `count` is negative. */
export function addDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

/** The first moment of a calendar day in Colombo. Sri Lanka keeps no daylight saving, so it is always UTC+05:30. */
export function colomboStartOf(day: string): Date {
  return new Date(`${day}T00:00:00+05:30`);
}

/**
 * The calendar day `count` months after `day` ("YYYY-MM-DD"), or before it when `count` is negative. A day
 * the other month hasn't, such as 31 March a month back, becomes that month's last day (28 or 29 February).
 */
export function addMonths(day: string, count: number): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(year, month - 1 + count, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(date, last));
  return first.toISOString().slice(0, 10);
}
