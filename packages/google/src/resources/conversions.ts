import type { GoogleAdsClient } from "../http.js";
import { search, gaqlList } from "../gaql.js";

export interface ConversionAction {
  id: string;
  resourceName: string;
  name: string;
  status: string;
  category?: string;
  type?: string;
  /** Whether this action feeds the "Conversions" column and so drives bidding. */
  primaryForGoal?: boolean;
}

/** Every conversion action on the account, so a launch can name one instead of guessing an id. */
export async function listConversionActions(client: GoogleAdsClient, customerId: string): Promise<ConversionAction[]> {
  const rows = await search(
    client,
    customerId,
    `SELECT conversion_action.id, conversion_action.resource_name, conversion_action.name,
            conversion_action.status, conversion_action.category, conversion_action.type,
            conversion_action.primary_for_goal
     FROM conversion_action
     WHERE conversion_action.status != 'REMOVED'
     ORDER BY conversion_action.name`,
  );
  return rows.map((r) => ({
    id: String(r.conversionAction?.id ?? ""),
    resourceName: r.conversionAction?.resourceName ?? "",
    name: r.conversionAction?.name ?? "",
    status: r.conversionAction?.status ?? "",
    category: r.conversionAction?.category,
    type: r.conversionAction?.type,
    primaryForGoal: r.conversionAction?.primaryForGoal,
  }));
}

/**
 * Resolve conversion action names to resource names. Returns what matched and
 * what did not, so a launch can warn about a typo rather than silently
 * tracking nothing.
 */
export async function resolveConversionActions(
  client: GoogleAdsClient,
  customerId: string,
  names: string[],
): Promise<{ found: ConversionAction[]; missing: string[] }> {
  if (!names.length) return { found: [], missing: [] };
  const rows = await search(
    client,
    customerId,
    `SELECT conversion_action.id, conversion_action.resource_name, conversion_action.name,
            conversion_action.status, conversion_action.category, conversion_action.type,
            conversion_action.primary_for_goal
     FROM conversion_action
     WHERE conversion_action.name IN ${gaqlList(names)} AND conversion_action.status != 'REMOVED'`,
  );
  const found = rows.map((r) => ({
    id: String(r.conversionAction?.id ?? ""),
    resourceName: r.conversionAction?.resourceName ?? "",
    name: r.conversionAction?.name ?? "",
    status: r.conversionAction?.status ?? "",
    category: r.conversionAction?.category,
    type: r.conversionAction?.type,
    primaryForGoal: r.conversionAction?.primaryForGoal,
  }));
  const foundNames = new Set(found.map((f) => f.name));
  return { found, missing: names.filter((n) => !foundNames.has(n)) };
}
