import type { GoogleAdsClient } from "./http.js";

/**
 * GAQL reads. Every report, lookup, and existence check in this package goes
 * through `search`, because Google Ads exposes essentially all of its data as
 * one query language rather than per-resource GET endpoints.
 *
 * Note on types: protobuf JSON encodes int64 as a *string*, so `metrics.impressions`
 * and `metrics.costMicros` arrive quoted. Never do arithmetic on them without
 * coercing first (see report.ts).
 */

export interface SearchRow {
  [resource: string]: any;
}

interface SearchStreamChunk {
  results?: SearchRow[];
  fieldMask?: string;
}

/**
 * Run a GAQL query and return every row.
 *
 * Uses `searchStream`, which returns the whole result set in one response with
 * no page tokens to thread. The response is a JSON array of chunks, each with
 * its own `results` array.
 */
export async function search(client: GoogleAdsClient, customerId: string, query: string): Promise<SearchRow[]> {
  const chunks = await client.request<SearchStreamChunk[]>({
    method: "POST",
    path: `/customers/${customerId}/googleAds:searchStream`,
    body: { query },
    isRead: true,
  });
  if (!Array.isArray(chunks)) return [];
  return chunks.flatMap((c) => c.results ?? []);
}

/** Run a query expected to match at most one row. */
export async function searchOne(
  client: GoogleAdsClient,
  customerId: string,
  query: string,
): Promise<SearchRow | undefined> {
  const rows = await search(client, customerId, query);
  return rows[0];
}

/**
 * Escape a string for a GAQL literal. GAQL has no bound parameters, so every
 * interpolated value has to be escaped here or a name containing a quote
 * becomes a broken query.
 */
export function gaqlString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Render a list for a GAQL `IN (...)` clause. */
export function gaqlList(values: string[]): string {
  return `(${values.map(gaqlString).join(", ")})`;
}

/** A `segments.date BETWEEN` clause from an ISO range, or "" when unbounded. */
export function dateClause(range?: { start: string; end: string }): string {
  return range ? ` AND segments.date BETWEEN ${gaqlString(range.start)} AND ${gaqlString(range.end)}` : "";
}
