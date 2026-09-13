/**
 * Unified competitor-ad scan.
 *
 * The official Ad Library API and the public-library scraper are complementary:
 *   - API     → reliable, scalable METADATA: advertiser, payer, format, run
 *               dates, impression ranges, per-country split, and structured
 *               targeting facets — but NO ad copy/creative.
 *   - Scraper → the ad COPY (and image), plus format/advertiser, from the public
 *               library; needs a local browser.
 *
 * Engines (option `engine`):
 *   - "auto" (default): query the API for metadata, then (deep) layer in copy by
 *     scraping the same advertiser and joining on ad id. Falls back to a pure
 *     scraper run if the API isn't provisioned / there's no auth.
 *   - "api": API only — metadata, no copy. No browser; works on the hosted MCP.
 *   - "scraper": browser only — copy + format + (EU) metadata. Local, no auth.
 */

import {
  scanAdLibrary,
  fetchAdCopyByIds,
  AdLibraryBlockedError,
  SCRAPER_DEFAULTS,
  type AdLibraryScanOptions,
  type AdLibraryScan,
  type AdLibraryAd,
} from "./adLibrary.js";
import { searchAdLibraryApi, AdLibraryAccessError } from "./adLibraryApi.js";

export type CompetitorAdsEngine = "auto" | "api" | "scraper";

export interface CompetitorAdsOptions extends AdLibraryScanOptions {
  engine?: CompetitorAdsEngine;
}

export interface CompetitorAdsResult {
  /** Which engine produced the result. */
  engine: "api" | "scraper";
  /** Notes, e.g. fallback reason or copy-enrichment coverage. */
  note?: string;
  query: { advertiser?: string; companyId?: string; keyword?: string; countries?: string[]; url?: string };
  totalReported?: number;
  fetched: number;
  ads: AdLibraryAd[];
}

export async function scanCompetitorAds(opts: CompetitorAdsOptions): Promise<CompetitorAdsResult> {
  const engine = opts.engine ?? "auto";
  const progress = opts.onProgress ?? (() => {});
  const deep = opts.deep ?? true;

  // The API has no company-id filter; only advertiser name or keyword.
  const apiUsable = Boolean(opts.advertiser || opts.keyword);

  if (engine === "api" || (engine === "auto" && apiUsable)) {
    try {
      progress("Querying the official LinkedIn Ad Library API...");
      const { createLiads } = await import("./client.js");
      const liads = await createLiads();
      const api = await searchAdLibraryApi(liads.client, {
        keyword: opts.keyword,
        advertiser: opts.advertiser,
        countries: opts.countries,
        max: opts.max,
        onProgress: progress,
      });
      const ads = api.ads as AdLibraryAd[];

      let note: string | undefined;
      if (deep && engine !== "api") {
        // Layer in ad copy by opening each ad's own detail page (guaranteed
        // coverage — the API and the public search list don't return the same
        // ad sets, so joining on a search scrape would miss most ads).
        //
        // Every page is a browser visit from the user's IP, and LinkedIn's
        // Cloudflare blocks the IP (their own browser included) when too many
        // arrive too fast. So: cap the pages, fetch them one at a time with a
        // pause, and stop at the first block instead of hammering on.
        const ids = ads.map((a) => a.detailId).filter(Boolean);
        const copyMax = Math.max(0, opts.copyMax ?? SCRAPER_DEFAULTS.copyMax);
        const targetIds = ids.slice(0, copyMax);
        const capNote =
          targetIds.length < ids.length
            ? ` Detail pages capped at ${targetIds.length} of ${ids.length} ads (each is a browser visit from your IP); raise copyMax deliberately for more.`
            : "";
        try {
          progress(`Layering in ad copy from ${targetIds.length} detail pages...`);
          let copyById: Map<string, { commentary?: string; imageUrl?: string; headline?: string; cta?: string }>;
          let blockNote = "";
          try {
            copyById = await fetchAdCopyByIds(targetIds, {
              concurrency: opts.concurrency,
              pageDelayMs: opts.pageDelayMs,
              headless: opts.headless,
              onProgress: progress,
            });
          } catch (e) {
            if (!(e instanceof AdLibraryBlockedError)) throw e;
            copyById = e.partialCopy ?? new Map();
            blockNote = ` ${e.message}`;
            progress(e.message);
          }
          let enriched = 0;
          for (const ad of ads) {
            const c = copyById.get(ad.detailId);
            if (c) {
              if (c.commentary) ad.commentary = c.commentary;
              if (c.imageUrl) ad.imageUrl = c.imageUrl;
              if (c.headline && ad.detail) ad.detail.headline = c.headline;
              if (c.cta && ad.detail) ad.detail.cta = c.cta;
              enriched++;
            }
          }
          note = `Copy layered onto ${enriched}/${ads.length} ads.${capNote}${blockNote}`;
        } catch (e) {
          note = `Copy not layered in (${e instanceof Error ? e.message : String(e)}); API metadata only.`;
          progress(note);
        }
      } else if (engine === "api") {
        note = "API metadata only (engine=api); no ad copy.";
      }

      return {
        engine: "api",
        note,
        query: { advertiser: opts.advertiser, companyId: opts.companyId, keyword: opts.keyword, countries: opts.countries },
        totalReported: api.totalReported,
        fetched: api.fetched,
        ads,
      };
    } catch (e) {
      if (engine === "api") throw e;
      const reason =
        e instanceof AdLibraryAccessError
          ? "Ad Library API not provisioned for this app"
          : e instanceof Error
            ? e.message
            : String(e);
      progress(`Official API unavailable (${reason}); falling back to the browser scraper.`);
      const scan = await scanAdLibrary(opts);
      return {
        engine: "scraper",
        ...toResultBody(scan),
        note: [`Used scraper fallback: ${reason}`, scan.note].filter(Boolean).join(" "),
      };
    }
  }

  // engine === "scraper", or "auto" with only a company id (API can't filter by id).
  if (engine === "auto" && !apiUsable) {
    progress("Only a company id was given; the API can't filter by id, using the browser scraper.");
  }
  const scan = await scanAdLibrary(opts);
  return { engine: "scraper", ...toResultBody(scan) };
}

function toResultBody(scan: AdLibraryScan): Omit<CompetitorAdsResult, "engine"> {
  return { query: scan.query, totalReported: scan.totalReported, fetched: scan.fetched, note: scan.note, ads: scan.ads };
}
