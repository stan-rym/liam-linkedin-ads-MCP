/**
 * The metric arithmetic every ad platform shares. Only the four base counters
 * that mean the same thing everywhere live here; each platform's report module
 * layers its own extras on top (LinkedIn adds leads and engagements, Google
 * adds conversion value and impression share).
 */

export const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0)) || 0;
/** Round to cents. */
export const r2 = (x: number): number => Math.round(x * 100) / 100;
/** Round a ratio to 4 places (0.0123 = 1.23%). */
export const r4 = (x: number): number => Math.round(x * 10000) / 10000;

/**
 * Relative change from `prev` to `curr`. Returns 0 when there is no baseline
 * and nothing happened; `sentinelOnZeroBase` makes a rise from zero read as
 * +100% rather than 0% (what a lift report wants, but not a trend line).
 */
export function pctChange(curr: number, prev: number, sentinelOnZeroBase = false): number {
  if (prev) return r4((curr - prev) / prev);
  return sentinelOnZeroBase && curr ? 1 : 0;
}

export interface CoreMetrics {
  impressions: number;
  clicks: number;
  costUsd: number;
  conversions: number;
}

export interface CoreKpis {
  /** Ratios (0-1). */
  ctr: number;
  cvr: number;
  /** Dollars. */
  cpc: number;
  cpm: number;
  costPerConversion: number;
}

/** Derive the universal KPIs from base counters. Every divisor is guarded. */
export function deriveCoreKpis(m: CoreMetrics): CoreKpis {
  const { impressions, clicks, costUsd, conversions } = m;
  return {
    ctr: impressions ? r4(clicks / impressions) : 0,
    cvr: clicks ? r4(conversions / clicks) : 0,
    cpc: clicks ? r2(costUsd / clicks) : 0,
    cpm: impressions ? r2((costUsd / impressions) * 1000) : 0,
    costPerConversion: conversions ? r2(costUsd / conversions) : 0,
  };
}

export function topBy<T>(rows: T[], metric: keyof T, n = 5): T[] {
  return [...rows].sort((a, b) => num(b[metric]) - num(a[metric])).slice(0, n);
}

export function bottomBy<T>(rows: T[], metric: keyof T, n = 5): T[] {
  return [...rows].sort((a, b) => num(a[metric]) - num(b[metric])).slice(0, n);
}
