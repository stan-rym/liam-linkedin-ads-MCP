/**
 * Named reporting periods and the date math behind them. Platform-neutral:
 * ranges are ISO "YYYY-MM-DD" strings, which Google Ads uses directly and
 * LinkedIn converts into its `{year, month, day}` shape.
 */

export type Period = "last_7_days" | "last_30_days" | "last_90_days" | "month_to_date" | "last_month";

export interface IsoDateRange {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, inclusive. */
  end: string;
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Resolve a named period into a concrete date range, relative to `now` (UTC). */
export function resolvePeriodIso(period: Period, now = new Date()): IsoDateRange {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = utc(y, m, now.getUTCDate());
  const back = (n: number) => {
    const s = new Date(today);
    s.setUTCDate(s.getUTCDate() - (n - 1));
    return { start: isoDay(s), end: isoDay(today) };
  };
  switch (period) {
    case "last_7_days": return back(7);
    case "last_30_days": return back(30);
    case "last_90_days": return back(90);
    case "month_to_date": return { start: isoDay(utc(y, m, 1)), end: isoDay(today) };
    // Day 0 of this month is the last day of the previous one.
    case "last_month": return { start: isoDay(utc(y, m - 1, 1)), end: isoDay(utc(y, m, 0)) };
  }
}

/** Resolve a range from an explicit start/end (YYYY-MM-DD) or a named period. */
export function resolveIsoDateRange(opts: { period?: Period; startDate?: string; endDate?: string }): IsoDateRange {
  if (opts.startDate && opts.endDate) return { start: opts.startDate, end: opts.endDate };
  return resolvePeriodIso(opts.period ?? "last_30_days");
}

/* ------------------------------ lift windows -------------------------------- */

export interface LiftWindowSpec {
  start: string;
  end: string;
  days: number;
  /** True when the window was clamped because the change is too recent to have a full one. */
  partial: boolean;
}

const dayUTC = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

/**
 * The two comparison windows around a change: the `windowDays` before it, and
 * the `windowDays` starting on the day of it. The after-window is clamped to
 * today and flagged `partial` when the change is too recent for a full window.
 */
export function liftWindows(changeTs: string, windowDays: number, now = new Date()): {
  before: LiftWindowSpec;
  after: LiftWindowSpec;
} {
  const today = dayUTC(now);
  const changeDay = dayUTC(new Date(changeTs));
  const beforeStart = addDays(changeDay, -windowDays);
  const beforeEnd = addDays(changeDay, -1);
  const fullAfterEnd = addDays(changeDay, windowDays - 1);
  const afterEnd = fullAfterEnd > today ? today : fullAfterEnd;
  const afterDays = Math.max(0, Math.round((afterEnd.getTime() - changeDay.getTime()) / 86400000) + 1);

  return {
    before: { start: isoDay(beforeStart), end: isoDay(beforeEnd), days: windowDays, partial: false },
    after: { start: isoDay(changeDay), end: isoDay(afterEnd), days: afterDays, partial: afterDays < windowDays },
  };
}
