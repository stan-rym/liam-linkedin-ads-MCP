import type { LinkedInClient } from "../http.js";
import { searchAll } from "./search.js";
import type { CampaignInput, CampaignUpdateInput } from "../schemas.js";
import { sponsoredAccountUrn, campaignGroupUrn, adSegmentUrn } from "../urns.js";
import { buildTargetingCriteria, geoSegmentSpec, withDefaultExclusions } from "./targeting.js";
import { associateCampaignWithConversion, resolveConversionIdByName } from "./conversions.js";
import { loadConfig, resolveDefaultConversionNames } from "../config.js";
import type { CreatedEntity } from "./campaignGroups.js";

/**
 * Creates a campaign ("ad group" in common parlance) — this is where targeting,
 * budget, bid, and schedule live. Defaults to DRAFT. Targeting comes from an
 * explicit targetingCriteria, or is built from geoUrns + audienceSegmentUrn.
 */
export async function createCampaign(
  client: LinkedInClient,
  input: CampaignInput,
): Promise<CreatedEntity> {
  // Targeting precedence: explicit raw criteria > structured spec > geo/segment shorthand.
  const baseCriteria =
    input.targetingCriteria ??
    buildTargetingCriteria(
      input.targeting ?? geoSegmentSpec(input.geoUrns, input.audienceSegmentUrn),
    );
  // Standing rule: apply default audience exclusions unless explicitly opted out.
  const targetingCriteria =
    (input.applyDefaultExclusions ?? true) ? withDefaultExclusions(baseCriteria) : baseCriteria;

  const body: Record<string, unknown> = {
    account: sponsoredAccountUrn(input.accountId),
    campaignGroup: campaignGroupUrn(input.campaignGroupId),
    name: input.name,
    type: input.type,
    costType: input.costType,
    locale: input.locale,
    runSchedule: input.runSchedule,
    status: input.status,
    targetingCriteria,
    // Hard rule: never enable Audience Expansion or the LinkedIn Audience
    // Network. Both are forced off on every ad set we create — they spend
    // budget on low-quality, off-target reach. Not configurable on purpose.
    audienceExpansionEnabled: false,
    offsiteDeliveryEnabled: false,
    politicalIntent: input.politicalIntent ?? "NOT_POLITICAL",
  };
  if (input.objectiveType) body.objectiveType = input.objectiveType;
  if (input.dailyBudget) body.dailyBudget = input.dailyBudget;
  if (input.totalBudget) body.totalBudget = input.totalBudget;
  if (input.unitCost) body.unitCost = input.unitCost;

  const res = await client.request({
    method: "POST",
    path: `/adAccounts/${input.accountId}/adCampaigns`,
    body,
  });
  if (!res.restliId) throw new Error("Campaign created but no id returned");

  // Conversions: use explicit ids if given, otherwise fall back to the account's
  // default conversion(s) (config.defaultConversionNames) unless opted out.
  let conversionIds = input.conversionIds ?? [];
  if (conversionIds.length === 0 && (input.applyDefaultConversion ?? true)) {
    const names = resolveDefaultConversionNames(await loadConfig());
    const resolved: string[] = [];
    for (const name of names) {
      const id = await resolveConversionIdByName(client, input.accountId, name);
      if (id) resolved.push(id);
    }
    conversionIds = resolved;
  }
  // Select existing conversions (e.g. an insight tag) for this campaign.
  for (const conversionId of conversionIds) {
    await associateCampaignWithConversion(client, input.accountId, conversionId, res.restliId);
  }
  return { id: res.restliId };
}

export async function getCampaign(client: LinkedInClient, accountId: string, campaignId: string) {
  const res = await client.request({ path: `/adAccounts/${accountId}/adCampaigns/${campaignId}` });
  return res.data;
}

export interface CampaignUpdateResult {
  id: string;
  /** Names of the fields included in the patch. */
  updated: string[];
  /** The targetingCriteria that was set, when targeting was changed. */
  targetingCriteria?: Record<string, unknown>;
  /** True when dryRun: the patch was built and returned but NOT sent. */
  dryRun?: boolean;
  /** The full PARTIAL_UPDATE $set payload (handy for review on a dry run). */
  patch?: Record<string, unknown>;
}

/**
 * Patch an existing campaign ("ad group") in place via LinkedIn PARTIAL_UPDATE.
 * Only the fields provided are changed. Targeting is replaced wholesale when any
 * targeting form is supplied (structured spec, audienceSegmentUrn shorthand, or
 * raw targetingCriteria) — built through the SAME helpers as createCampaign, so
 * the standing default exclusions and the include/exclude tree stay identical.
 * The Audience Expansion / Audience Network off-switches are campaign-create
 * settings and are never re-enabled here. With dryRun the patch is returned but
 * not sent, so callers can preview a change before touching a live campaign.
 */
export async function updateCampaign(
  client: LinkedInClient,
  input: CampaignUpdateInput,
): Promise<CampaignUpdateResult> {
  const patch: Record<string, unknown> = {};

  const hasTargeting =
    input.targetingCriteria !== undefined ||
    input.targeting !== undefined ||
    input.audienceSegmentUrn !== undefined ||
    (input.geoUrns?.length ?? 0) > 0;

  let targetingCriteria: Record<string, unknown> | undefined;
  if (hasTargeting) {
    const base =
      input.targetingCriteria ??
      buildTargetingCriteria(
        input.targeting ??
          geoSegmentSpec(
            input.geoUrns,
            input.audienceSegmentUrn ? adSegmentUrn(input.audienceSegmentUrn) : undefined,
          ),
      );
    targetingCriteria =
      (input.applyDefaultExclusions ?? true) ? withDefaultExclusions(base) : base;
    patch.targetingCriteria = targetingCriteria;
  }

  if (input.name !== undefined) patch.name = input.name;
  if (input.status !== undefined) patch.status = input.status;
  if (input.dailyBudget !== undefined) patch.dailyBudget = input.dailyBudget;
  if (input.totalBudget !== undefined) patch.totalBudget = input.totalBudget;
  if (input.unitCost !== undefined) patch.unitCost = input.unitCost;
  if (input.runSchedule !== undefined) patch.runSchedule = input.runSchedule;

  const updated = Object.keys(patch);
  if (updated.length === 0) {
    throw new Error("Nothing to update: provide targeting and/or a field to change.");
  }

  if (input.dryRun) {
    return { id: input.campaignId, updated, targetingCriteria, dryRun: true, patch };
  }

  await client.request({
    method: "POST",
    path: `/adAccounts/${input.accountId}/adCampaigns/${input.campaignId}`,
    headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
    body: { patch: { $set: patch } },
  });
  return { id: input.campaignId, updated, targetingCriteria };
}

/** Change a campaign's status (e.g. archive cleanup). */
export async function setCampaignStatus(
  client: LinkedInClient,
  accountId: string,
  campaignId: string,
  status: "ACTIVE" | "PAUSED" | "DRAFT" | "ARCHIVED",
): Promise<void> {
  await client.request({
    method: "POST",
    path: `/adAccounts/${accountId}/adCampaigns/${campaignId}`,
    headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
    body: { patch: { $set: { status } } },
  });
}

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  campaignGroupId: string;
  format?: string;
  objectiveType?: string;
}

/**
 * List ALL campaigns ("ad groups") on the account, drafts included, optionally
 * scoped to one campaign group. Reads account structure directly rather than
 * analytics, so zero-spend drafts show up.
 */
export async function listCampaigns(
  client: LinkedInClient,
  accountId: string,
  opts: { groupId?: string; includeArchived?: boolean } = {},
): Promise<CampaignSummary[]> {
  const els = await searchAll<{
    id: number | string;
    name?: string;
    status?: string;
    campaignGroup?: string;
    format?: string;
    objectiveType?: string;
  }>(client, `/adAccounts/${accountId}/adCampaigns`);
  return els
    .map((e) => ({
      id: String(e.id),
      name: e.name ?? "",
      status: e.status ?? "",
      campaignGroupId: String(e.campaignGroup ?? "").replace("urn:li:sponsoredCampaignGroup:", ""),
      format: e.format,
      objectiveType: e.objectiveType,
    }))
    .filter((c) => opts.includeArchived || !["ARCHIVED", "REMOVED"].includes(c.status))
    .filter((c) => !opts.groupId || c.campaignGroupId === opts.groupId);
}
