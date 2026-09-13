import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createLiads,
  listAdAccounts,
  estimateAudience,
  searchTargeting,
  listTargetingFacets,
  listFacetEntities,
  COMMON_FACETS,
  TargetingSpecSchema,
  uploadAudienceFromFile,
  audienceFromSalesforce,
  listConversions,
  getDmpSegment,
  requireDefaultAccountId,
  SalesforceAudienceSchema,
  createCampaignGroup,
  createCampaign,
  updateCampaign,
  createTextAdCreative,
  createSponsoredImageDraft,
  launchFromBrief,
  getPerformance,
  performanceSummary,
  performanceTrend,
  resolveDateRange,
  PerformanceQuerySchema,
  SummaryQuerySchema,
  TrendQuerySchema,
  CampaignGroupInputSchema,
  CampaignInputSchema,
  CampaignUpdateSchema,
  TextAdCreativeSchema,
  SponsoredImageCreativeSchema,
  LaunchFromBriefSchema,
  scanCompetitorAds,
  AdLibraryScanSchema,
  recordChange,
  readChanges,
  computeLift,
  listCampaignGroups,
  listCampaigns,
  listCreatives,
  deleteAd,
} from "@liads/core";

const AD_ENTITY_TYPE = z
  .enum(["campaignGroup", "campaign", "creative"])
  .describe("campaignGroup (the 'campaign'), campaign (the 'ad group'), or creative (the 'ad')");

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }],
});

/**
 * Registers every LinkedIn ads tool on an MCP server. Shared by the local stdio
 * entry point and the hosted (Vercel) HTTP handler so both expose the same surface.
 */
export function registerTools(server: McpServer): void {
  server.tool("list_ad_accounts", "List LinkedIn ad accounts this app can access.", {}, async () => {
    try {
      const liads = await createLiads();
      return ok(await listAdAccounts(liads.client));
    } catch (e) {
      return fail(e);
    }
  });

  server.tool(
    "list_targeting_facets",
    `List LinkedIn targeting facets you can target on. Common short names: ${Object.keys(COMMON_FACETS).join(", ")}.`,
    {},
    async () => {
      try {
        const liads = await createLiads();
        return ok(await listTargetingFacets(liads.client));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "search_targeting",
    "Typeahead-search entities within a facet to get their URNs (e.g. facet='titles', query='marketing' -> Marketing Manager urn). Use 'list_facet_entities' for small fixed sets like seniorities. These URNs go into a targeting spec.",
    { facet: z.string().describe("short facet name, e.g. titles, industries, skills, staffCountRanges, locations"), query: z.string() },
    async ({ facet, query }) => {
      try {
        const liads = await createLiads();
        return ok(await searchTargeting(liads.client, facet, query));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "list_facet_entities",
    "List all entities of a small facet (e.g. seniorities, functions, degrees) to pick URNs from.",
    { facet: z.string().describe("short facet name, e.g. seniorities") },
    async ({ facet }) => {
      try {
        const liads = await createLiads();
        return ok(await listFacetEntities(liads.client, facet));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "estimate_audience",
    "Estimate audience size for a structured targeting spec (facet short name -> entity URNs). A campaign needs >=300 members to serve.",
    TargetingSpecSchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        return ok(await estimateAudience(liads.client, TargetingSpecSchema.parse(args)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "upload_audience_csv",
    "Clean a CSV at csvPath and upload it as a matched-audience DMP segment. Auto-detects contact (email) vs company (account) lists, normalizes column names, drops non-matcher columns, hashes emails, and converts company domains to website URLs. Requires the Audiences product; matching takes up to 48h.",
    {
      accountId: z.string().optional(),
      name: z.string(),
      csvPath: z.string().describe("Path to the CSV file on the server"),
      type: z.enum(["contact", "company"]).optional().describe("Force the list type; auto-detected if omitted"),
    },
    async ({ accountId, name, csvPath, type }) => {
      try {
        const liads = await createLiads();
        const acct = accountId ?? (await requireDefaultAccountId());
        return ok(await uploadAudienceFromFile(liads.client, liads.getToken, { accountId: acct, name, csvPath, type }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "audience_from_salesforce",
    "Build a matched audience from a Salesforce SOQL query that selects an email column. Closes the loop: flagged accounts/contacts -> DMP segment. Requires the local `sf` CLI to be authenticated.",
    SalesforceAudienceSchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        return ok(await audienceFromSalesforce(liads.client, liads.getToken, SalesforceAudienceSchema.parse(args)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "list_conversions",
    "List the account's existing conversions (insight tags) so you can select one to track on a campaign. Pass accountId or omit to use the default.",
    { accountId: z.string().optional() },
    async ({ accountId }) => {
      try {
        const liads = await createLiads();
        const acct = accountId ?? (await requireDefaultAccountId());
        return ok(await listConversions(liads.client, acct));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "list_campaigns",
    "List the account structure: campaign groups (campaigns) and/or their campaigns (ad groups), DRAFTS INCLUDED — unlike performance reports, which only show entities with spend. Pass level=groups for campaign groups only, level=campaigns for ad groups (optionally scoped by groupId), or level=both (default) for the full tree.",
    {
      accountId: z.string().optional(),
      level: z.enum(["groups", "campaigns", "both"]).default("both"),
      groupId: z.string().optional().describe("Scope campaigns to one campaign group id"),
      includeArchived: z.boolean().default(false),
    },
    async ({ accountId, level, groupId, includeArchived }) => {
      try {
        const liads = await createLiads();
        const acct = accountId ?? (await requireDefaultAccountId());
        const out: Record<string, unknown> = {};
        if (level !== "campaigns") out.groups = await listCampaignGroups(liads.client, acct, { includeArchived });
        if (level !== "groups") out.campaigns = await listCampaigns(liads.client, acct, { groupId, includeArchived });
        return ok(out);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "list_ads",
    "List the creatives (ads) in a campaign (ad group), drafts included: id, name, status, and backing post urn.",
    { accountId: z.string().optional(), campaignId: z.string() },
    async ({ accountId, campaignId }) => {
      try {
        const liads = await createLiads();
        const acct = accountId ?? (await requireDefaultAccountId());
        return ok(await listCreatives(liads.client, acct, campaignId));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "delete_ad",
    "Delete an ad: removes the creative and (best-effort) the Direct Sponsored Content post behind it. Accepts a numeric creative id or a full urn:li:sponsoredCreative URN. Use for cleaning up drafts or replacing an ad whose copy must change (Campaign Manager's editor does not reflect post edits — recreate instead).",
    { accountId: z.string().optional(), creativeId: z.string() },
    async ({ accountId, creativeId }) => {
      try {
        const liads = await createLiads();
        const acct = accountId ?? (await requireDefaultAccountId());
        return ok(await deleteAd(liads.client, acct, creativeId));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "get_audience_status",
    "Check a DMP segment's matching status and resolved size.",
    { segmentId: z.string() },
    async ({ segmentId }) => {
      try {
        const liads = await createLiads();
        return ok(await getDmpSegment(liads.client, segmentId));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "create_campaign_group",
    "Create a campaign group (the top-level 'campaign'). Defaults to DRAFT.",
    CampaignGroupInputSchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        return ok(await createCampaignGroup(liads.client, CampaignGroupInputSchema.parse(args)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "create_campaign",
    "Create a campaign (the 'ad group') with targeting, budget, bid, schedule. Defaults to DRAFT.",
    CampaignInputSchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        return ok(await createCampaign(liads.client, CampaignInputSchema.parse(args)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "update_campaign",
    "Update an existing campaign (the 'ad group') in place: change its targeting and/or name, status, budget, bid, schedule. Only the fields you pass change. Targeting is REPLACED when you pass any targeting form — a structured `targeting` spec, the `audienceSegmentUrn` (+ optional `geoUrns`) shorthand, or a raw `targetingCriteria`; default exclusions are re-applied unless applyDefaultExclusions=false. Audience Expansion / Audience Network stay off. Pass dryRun=true first to preview the patch before touching a live campaign.",
    CampaignUpdateSchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        return ok(await updateCampaign(liads.client, CampaignUpdateSchema.parse(args)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "create_text_ad",
    "Create a Text Ad creative (DRAFT by default).",
    TextAdCreativeSchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        return ok(await createTextAdCreative(liads.client, TextAdCreativeSchema.parse(args)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "create_image_ad",
    "Create a single-image Sponsored Content creative (DRAFT). Omit imagePath to leave the campaign ready for an image later.",
    SponsoredImageCreativeSchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        const input = SponsoredImageCreativeSchema.parse(args);
        return ok(await createSponsoredImageDraft(liads.client, liads.getToken, input));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "performance_summary",
    "Account performance rollup over a period: totals + KPIs, top campaigns by spend/CTR, worst by cost-per-conversion, and flagged campaigns (spend with no conversions, high CPC, low CTR). Start here for 'how are my ads doing'.",
    SummaryQuerySchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        const q = SummaryQuerySchema.parse(args);
        const accountId = q.accountId ?? (await requireDefaultAccountId());
        return ok(await performanceSummary(liads.client, { accountId, dateRange: resolveDateRange(q) }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "get_performance",
    "Per-entity performance with derived KPIs (CTR, CPC, CPM, CPL, conversion rate). level: campaign_group (campaign), campaign (ad group), or creative (ad). Pass parentId to scope campaigns to a group or creatives to a campaign.",
    PerformanceQuerySchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        const q = PerformanceQuerySchema.parse(args);
        const accountId = q.accountId ?? (await requireDefaultAccountId());
        return ok(
          await getPerformance(liads.client, { accountId, level: q.level, parentId: q.parentId, dateRange: resolveDateRange(q) }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "performance_trend",
    "Weekly or monthly trend for one entity, with period-over-period deltas on impressions, clicks, spend, conversions, and CTR. Use to spot momentum or creative fatigue.",
    TrendQuerySchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        const q = TrendQuerySchema.parse(args);
        return ok(
          await performanceTrend(liads.client, { level: q.level, entityId: q.entityId, bucket: q.bucket, dateRange: resolveDateRange(q) }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "launch_from_brief",
    "End-to-end: optional audience upload -> campaign group -> campaign -> draft creatives. Everything DRAFT. Returns Campaign Manager review links.",
    LaunchFromBriefSchema.shape,
    async (args) => {
      try {
        const liads = await createLiads();
        return ok(await launchFromBrief(liads, LaunchFromBriefSchema.parse(args)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "log_ad_change",
    "Record a change to an ad entity in the local change journal, so a later lift report can compare performance before vs. after it. Liam logs its own changes automatically — use this for changes made elsewhere (e.g. in Campaign Manager) or to attach a hypothesis/label. Provide field+after for a field change, or note for a freeform annotation.",
    {
      entityType: AD_ENTITY_TYPE,
      entityId: z.string().describe("Numeric id of the campaign group / campaign / creative"),
      name: z.string().optional().describe("Human name of the entity (for nicer listings)"),
      field: z.string().optional().describe("Field that changed, e.g. dailyBudget, headline, status"),
      before: z.string().optional().describe("Prior value, if known"),
      after: z.string().optional().describe("New value"),
      note: z.string().optional().describe("Freeform note (used when there is no specific field)"),
      label: z.string().optional().describe("Hypothesis/label, e.g. 'outcome-led headline test'"),
      tags: z.array(z.string()).optional(),
      at: z.string().optional().describe("ISO 8601 time the change took effect; defaults to now"),
    },
    async ({ entityType, entityId, name, field, before, after, note, label, tags, at }) => {
      try {
        const isUpdate = Boolean(field);
        return ok(
          await recordChange({
            source: "manual",
            kind: isUpdate ? "update" : "note",
            entity: { type: entityType, id: entityId, name },
            fields: isUpdate ? [{ field: field!, before, after }] : undefined,
            summary: isUpdate ? `${field} → ${after ?? "(set)"}` : note,
            label,
            tags,
            ts: at,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "list_ad_changes",
    "List recorded ad changes (newest first) from the local change journal. Filter by entity type/id or tag. Use this to see what's been changed before computing lift.",
    {
      entityType: AD_ENTITY_TYPE.optional(),
      entityId: z.string().optional(),
      tag: z.string().optional(),
      limit: z.number().int().positive().optional().describe("Max rows (default 50)"),
    },
    async ({ entityType, entityId, tag, limit }) => {
      try {
        const all = await readChanges({ type: entityType, id: entityId, tag });
        return ok(all.slice(0, limit ?? 50));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "compute_lift",
    "For each recorded change to an entity, compare performance in the window before the change against the window after it (default 14 days each side). Returns before/after KPI windows and per-metric relative deltas (CTR, CPC, conversion rate, cost-per-conversion, etc.). This is a directional pre/post comparison, NOT a controlled experiment — confounded by seasonality, the LinkedIn learning phase after edits, and concurrent budget changes; present it as a signal and call out partial after-windows on recent changes.",
    {
      entityType: AD_ENTITY_TYPE,
      entityId: z.string(),
      windowDays: z.number().int().positive().optional().describe("Days on each side of a change (default 14)"),
    },
    async ({ entityType, entityId, windowDays }) => {
      try {
        const liads = await createLiads();
        return ok(await computeLift(liads.client, { type: entityType, entityId, windowDays }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.tool(
    "inspect_competitor_ads",
    "Pull a competitor's (or any company's) live and recent ads from the LinkedIn Ad Library. Prefers the official Ad Library API (engine 'auto'/'api'; works hosted but the app must be granted the 'LinkedIn Ad Library' product, else it 403s and 'auto' falls back to a local browser scraper — local only). Returns each ad's advertiser, sponsor ('promoted by'), full copy, format, image, and run dates / estimated impressions / per-country targeting (EU-served ads). Use to analyze messaging themes, offers, creative formats, posting cadence, and how their account is run. Name search is broad (includes partners/resellers); pass a numeric companyId for one company's own ads. Copy costs one browser visit per ad from the user's IP, so detail pages are capped at copyMax (50) per run, fetched one at a time, and the run stops at the first Cloudflare block (reported in 'note'; a block also locks the user out of the Ad Library in their own browser, so do not retry or probe the pages another way). Synthesize themes/trends rather than dumping ads raw.",
    AdLibraryScanSchema.shape,
    async (args) => {
      try {
        const q = AdLibraryScanSchema.parse(args);
        return ok(await scanCompetitorAds(q));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
