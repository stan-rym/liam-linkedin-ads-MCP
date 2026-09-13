/// <reference lib="dom" />
import type { Page } from "playwright";
/**
 * Competitor ad intelligence via the public LinkedIn Ad Library.
 *
 * This is the one part of Liam that does NOT use the authenticated Marketing
 * API (which only ever sees your own ad accounts). The Ad Library
 * (https://www.linkedin.com/ad-library) is public and shows every advertiser's
 * live and recent ads. We render it with a headless browser because both the
 * "see more" pagination and the per-ad transparency panel (run dates, impression
 * ranges, country breakdown) are hydrated client-side and never appear in the
 * raw HTML.
 *
 * Playwright is imported lazily so the rest of @liads/core stays importable in
 * environments without a browser (e.g. the hosted Vercel MCP). Competitor
 * scanning only works where a real Chrome/Chromium is available — locally.
 */

const AD_LIBRARY_BASE = "https://www.linkedin.com/ad-library";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Scraper pacing defaults. The public library sits behind Cloudflare, which
 * blocks the visitor's IP (the user's own browser included) once a headless
 * session opens too many pages too fast. One page at a time with a pause
 * between pages, capped at a few dozen pages per run, is the ceiling that has
 * stayed under the radar. Callers may raise these deliberately.
 */
export const SCRAPER_DEFAULTS = {
  /** Parallel detail-page fetches. */
  concurrency: 1,
  /** Pause between detail pages per worker, in ms. */
  pageDelayMs: 1500,
  /** Most ads to open detail pages for in one run. */
  copyMax: 50,
} as const;

/** Thrown when LinkedIn's Cloudflare wall answers instead of the Ad Library. */
export class AdLibraryBlockedError extends Error {
  /** Detail pages fetched before the block. */
  readonly pagesFetched: number;
  /** Copy collected before the block, when the caller was layering copy. */
  partialCopy?: Map<string, AdCopy>;
  constructor(pagesFetched: number, where: string) {
    super(
      `LinkedIn blocked this IP while opening ${where} (Cloudflare "Sorry, you have been blocked"). ` +
        `Stopped after ${pagesFetched} page(s) so the block stays short. It also hits the user's own browser, ` +
        `so wait a few hours or switch networks before scraping again, and do not retry with other HTTP clients.`,
    );
    this.name = "AdLibraryBlockedError";
    this.pagesFetched = pagesFetched;
  }
}

/**
 * True when a response is Cloudflare's block or challenge page rather than the
 * library. A headless browser never passes the challenge, so both count.
 */
export function isBlockedPage(status: number | undefined, title: string, bodyText: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  if (/attention required!?\s*\|\s*cloudflare/i.test(title)) return true;
  if (/just a moment/i.test(title) && /cloudflare|challenge/i.test(bodyText)) return true;
  if (/sorry, you have been blocked/i.test(bodyText) && /cloudflare/i.test(bodyText)) return true;
  return false;
}

/** Navigate, and throw AdLibraryBlockedError instead of parsing a block page. */
async function gotoOrThrowIfBlocked(page: Page, url: string, pagesFetched: number, where: string): Promise<void> {
  let status: number | undefined;
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    status = res?.status();
  } catch (e) {
    // Chrome surfaces a bodiless 4xx as this net error rather than a response.
    if (/ERR_HTTP_RESPONSE_CODE_FAILURE/.test(e instanceof Error ? e.message : String(e))) {
      throw new AdLibraryBlockedError(pagesFetched, where);
    }
    throw e;
  }
  const title = await page.title().catch(() => "");
  const body =
    status !== undefined && status >= 400
      ? await page.evaluate(() => (document.body as HTMLElement | null)?.innerText ?? "").catch(() => "")
      : "";
  if (isBlockedPage(status, title, body)) throw new AdLibraryBlockedError(pagesFetched, where);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A single ad as shown on the Ad Library search results (card) level. */
export interface AdLibraryCard {
  detailId: string;
  detailUrl: string;
  /** Displayed name on the card. For thought-leader ads this is the person, not the sponsor. */
  advertiser: string;
  /** The "Promoted" / "Promoted by <company>" line, when present (identifies the real sponsor). */
  promotedBy?: string;
  /** The ad body copy (the post text). Absent for image-only ads. */
  commentary?: string;
  /** LinkedIn creative type, e.g. SPONSORED_STATUS_UPDATE, TEXT_AD, SPOTLIGHT_V2. */
  format?: string;
  imageUrl?: string;
}

/** Per-ad transparency data, from the ad's detail page (scraper) or the API. */
export interface AdLibraryDetail {
  format?: string;
  /** Legal entity from "Paid for by ..." (API: advertiser.adPayer). */
  paidForBy?: string;
  /** Advertiser's LinkedIn page/profile URL (API only). */
  advertiserUrl?: string;
  /** The creative headline (distinct from the body copy). Scraper only. */
  headline?: string;
  /** Call-to-action button label, e.g. "Learn more", "Download". Scraper only. */
  cta?: string;
  /** First served date, "MMM D, YYYY" (scraper) or YYYY-MM-DD (API). EU-served ads only. */
  ranFrom?: string;
  /** Last served date. EU-served ads only. */
  ranTo?: string;
  /** Estimated total impressions range, e.g. "150k-200k" or "1k-5k". EU-served ads only. */
  totalImpressions?: string;
  /** Per-country impression share. EU-served ads only. */
  impressionsByCountry?: { country: string; share: string }[];
  /** Structured targeting facets the advertiser selected (API only). EU-served ads only. */
  targeting?: { facet: string; included: string[]; excluded: string[] }[];
}

export type AdLibraryAd = AdLibraryCard & { detail?: AdLibraryDetail };

export interface AdLibraryScanOptions {
  /** Advertiser display name (accountOwner). */
  advertiser?: string;
  /** Numeric LinkedIn company id (companyIds). More precise than name. */
  companyId?: string;
  /** Free-text keyword search across ad copy. */
  keyword?: string;
  /** ISO-3166 country codes to scope the search, e.g. ["US", "GB"]. */
  countries?: string[];
  /** Max ads to collect (default 50). Big advertisers have thousands. */
  max?: number;
  /** Fetch each ad's detail page for run dates / impressions / targeting (default true). */
  deep?: boolean;
  /** Parallel detail-page fetches when deep (default 1; see SCRAPER_DEFAULTS). */
  concurrency?: number;
  /** Pause between detail pages per worker in ms (default 1500). */
  pageDelayMs?: number;
  /** Most ads to open detail pages for in one run (default 50). */
  copyMax?: number;
  /** Run the browser headless (default true). */
  headless?: boolean;
  /** Progress callback for long scans. */
  onProgress?: (msg: string) => void;
}

export interface AdLibraryScan {
  query: { advertiser?: string; companyId?: string; keyword?: string; countries?: string[]; url: string };
  /** The "N ads" count the library reports for this advertiser, when shown. */
  totalReported?: number;
  /** How many ads we actually collected. */
  fetched: number;
  /** Caveats about coverage, e.g. a detail-page cap or a Cloudflare block. */
  note?: string;
  ads: AdLibraryAd[];
}

/**
 * Turn a free-form competitor reference into structured scan options.
 * Accepts: a numeric company id, a linkedin.com/company/<id> URL, an
 * /ad-library/search?... URL (passed through), or a plain advertiser name.
 */
export function parseAdvertiserQuery(input: string): Partial<AdLibraryScanOptions> & { rawUrl?: string } {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return { companyId: trimmed };

  // An ad-library search URL — pull its params back out.
  const searchUrl = trimmed.match(/ad-library\/search\?(.+)$/);
  if (searchUrl) {
    const p = new URLSearchParams(searchUrl[1]);
    const companyId = p.get("companyIds") ?? undefined;
    const advertiser = p.get("accountOwner") ?? undefined;
    const keyword = p.get("keyword") ?? undefined;
    return { companyId, advertiser, keyword, rawUrl: trimmed };
  }

  // A company page URL with a numeric id.
  const companyUrl = trimmed.match(/linkedin\.com\/company\/(\d+)/);
  if (companyUrl) return { companyId: companyUrl[1] };

  return { advertiser: trimmed };
}

/** Build the Ad Library search URL for a set of options. */
export function buildSearchUrl(opts: AdLibraryScanOptions): string {
  const url = new URL(`${AD_LIBRARY_BASE}/search`);
  if (opts.companyId) url.searchParams.set("companyIds", opts.companyId);
  if (opts.advertiser) url.searchParams.set("accountOwner", opts.advertiser);
  if (opts.keyword) url.searchParams.set("keyword", opts.keyword);
  if (opts.countries?.length) url.searchParams.set("countries", opts.countries.join(","));
  return url.toString();
}

/** Lazily import Playwright and launch the system Chrome (no bundled-browser download needed). */
async function launchBrowser(headless: boolean) {
  let pw: typeof import("playwright");
  try {
    // webpackIgnore keeps the hosted (Next.js) bundle from trying to resolve
    // playwright; it is only ever loaded locally when a scan actually runs.
    pw = await import(/* webpackIgnore: true */ "playwright");
  } catch {
    throw new Error(
      "Playwright is not installed. Run `pnpm -r install` in the linkedin-ads repo to enable competitor ad scanning.",
    );
  }
  // Prefer the installed Google Chrome (channel) so we don't need a Chromium download.
  try {
    return await pw.chromium.launch({ channel: "chrome", headless });
  } catch {
    try {
      return await pw.chromium.launch({ headless });
    } catch (e) {
      throw new Error(
        "Could not launch a browser. Install Google Chrome, or run `npx playwright install chromium`. " +
          (e instanceof Error ? e.message : String(e)),
      );
    }
  }
}

/* ------------------------------ in-page parsers ----------------------------- */
/* These functions are stringified and run inside the page via evaluate(), so
   they must be self-contained (no closure over module scope). */

function extractCardsInPage(): AdLibraryCard[] {
  const text = (el: Element | null | undefined) => (el ? (el as HTMLElement).innerText.trim() : "");
  const items = Array.from(document.querySelectorAll("li.search-result-item"));
  const out: AdLibraryCard[] = [];
  const seen = new Set<string>();
  for (const li of items) {
    const anchor = li.querySelector<HTMLAnchorElement>('a[href*="/ad-library/detail/"]');
    const href = anchor?.getAttribute("href") ?? "";
    const id = href.match(/detail\/(\d+)/)?.[1];
    if (!id || id === "12345678" || seen.has(id)) continue;
    seen.add(id);

    const preview = li.querySelector("[data-creative-type]");
    const promotedEl = Array.from(li.querySelectorAll(".text-color-text-secondary")).find((e) =>
      /promot/i.test((e as HTMLElement).innerText),
    );
    const advEl =
      li.querySelector(".text-color-text.font-bold") ||
      li.querySelector('[class*="brand-lockup"]') ||
      li.querySelector(".font-bold");
    const img = li.querySelector<HTMLImageElement>("img[data-delayed-url], img[src]");

    out.push({
      detailId: id,
      detailUrl: `https://www.linkedin.com/ad-library/detail/${id}`,
      advertiser: text(advEl),
      promotedBy: promotedEl ? text(promotedEl) : undefined,
      commentary: text(li.querySelector(".commentary__content")) || undefined,
      format: preview?.getAttribute("data-creative-type") ?? undefined,
      imageUrl: img?.getAttribute("data-delayed-url") || img?.getAttribute("src") || undefined,
    });
  }
  return out;
}

/** Parse a detail page's visible text + creative type into structured transparency fields. */
export function parseDetail(innerText: string, creativeType?: string): AdLibraryDetail {
  const detail: AdLibraryDetail = {};
  if (creativeType) detail.format = creativeType;

  const paid = innerText.match(/Paid for by\s+(.+)/);
  if (paid?.[1]) detail.paidForBy = paid[1].trim();

  const ran = innerText.match(/Ran from\s+(.+?)\s+to\s+(.+)/);
  if (ran?.[1] && ran[2]) {
    detail.ranFrom = ran[1].trim();
    detail.ranTo = ran[2].trim();
  } else {
    const ranOne = innerText.match(/Ran on\s+(.+)/);
    if (ranOne?.[1]) detail.ranFrom = detail.ranTo = ranOne[1].trim();
  }

  const impr = innerText.match(/Total Impressions\s*\n\s*([0-9][0-9.,kKmM+\s-]*)/);
  if (impr?.[1]) detail.totalImpressions = impr[1].trim();

  // Country lines come as "<country>\n<pct>%".
  const countries: { country: string; share: string }[] = [];
  const countryRe = /([A-Z][A-Za-z .'-]+)\n(\d+(?:\.\d+)?%)/g;
  let m: RegExpExecArray | null;
  while ((m = countryRe.exec(innerText))) {
    const name = m[1]?.trim();
    const share = m[2];
    if (!name || !share || /impression|total|country|advertiser|paid/i.test(name)) continue;
    countries.push({ country: name, share });
  }
  if (countries.length) detail.impressionsByCountry = countries;

  return detail;
}

function extractDetailInPage(): { innerText: string; creativeType?: string; headline?: string; cta?: string } {
  const preview = document.querySelector("[data-creative-type]");
  const headlineEl =
    document.querySelector(".sponsored-status-update-preview a[data-tracking-control-name*='headline']") ||
    document.querySelector("[class*='headline']");
  const ctaEl = document.querySelector("a[class*='cta'], button[class*='cta'], .ad-preview a[role='button']");
  return {
    innerText: (document.body as HTMLElement).innerText,
    creativeType: preview?.getAttribute("data-creative-type") ?? undefined,
    headline: headlineEl ? (headlineEl as HTMLElement).innerText.trim() : undefined,
    cta: ctaEl ? (ctaEl as HTMLElement).innerText.trim() : undefined,
  };
}

/** Ad copy + creative scraped from a single detail page. */
export interface AdCopy {
  commentary?: string;
  imageUrl?: string;
  headline?: string;
  cta?: string;
}

function extractCopyInPage(): AdCopy {
  const text = (el: Element | null) => (el ? (el as HTMLElement).innerText.trim() : undefined);
  const img = document.querySelector<HTMLImageElement>(".ad-preview img[data-delayed-url], .ad-preview img[src]");
  const preview = document.querySelector("[data-creative-type]");
  const headlineEl =
    (preview?.querySelector("a[data-tracking-control-name*='headline']") as Element | null) ||
    document.querySelector("[class*='headline']");
  const ctaEl = document.querySelector(".ad-preview a[role='button'], a[class*='cta'], button[class*='cta']");
  return {
    commentary: text(document.querySelector(".commentary__content")),
    imageUrl: img?.getAttribute("data-delayed-url") || img?.getAttribute("src") || undefined,
    headline: text(headlineEl),
    cta: text(ctaEl),
  };
}

/**
 * Fetch ad copy/creative for a specific set of ad ids by opening each ad's
 * public detail page. Used to layer copy onto the metadata the official API
 * returns (which has no creative). Returns a map keyed by detail id; ids whose
 * page fails are simply absent. Never throws for an individual page.
 */
export async function fetchAdCopyByIds(
  detailIds: string[],
  opts: { concurrency?: number; pageDelayMs?: number; headless?: boolean; onProgress?: (m: string) => void } = {},
): Promise<Map<string, AdCopy>> {
  const out = new Map<string, AdCopy>();
  if (!detailIds.length) return out;
  const concurrency = Math.max(1, opts.concurrency ?? SCRAPER_DEFAULTS.concurrency);
  const pageDelayMs = Math.max(0, opts.pageDelayMs ?? SCRAPER_DEFAULTS.pageDelayMs);
  const headless = opts.headless ?? true;
  const progress = opts.onProgress ?? (() => {});

  const browser = await launchBrowser(headless);
  try {
    const ctx = await browser.newContext({ userAgent: DESKTOP_UA, viewport: { width: 1280, height: 1600 } });
    let idx = 0;
    let done = 0;
    let blocked: AdLibraryBlockedError | undefined;
    const worker = async () => {
      while (idx < detailIds.length && !blocked) {
        const my = idx++;
        const id = detailIds[my];
        if (!id) continue;
        const dp = await ctx.newPage();
        try {
          await gotoOrThrowIfBlocked(dp, `https://www.linkedin.com/ad-library/detail/${id}`, done, "an ad detail page");
          // The creative hydrates client-side; wait for the copy/preview to
          // appear rather than a fixed delay (a fixed wait missed slow pages).
          await dp
            .waitForSelector(".commentary__content, [data-creative-type]", { timeout: 9000 })
            .catch(() => {});
          await dp.waitForTimeout(400);
          const copy = (await dp.evaluate(extractCopyInPage)) as AdCopy;
          if (copy.commentary || copy.imageUrl || copy.headline) out.set(id, copy);
        } catch (e) {
          // A block ends the whole run; anything else is one flaky page.
          if (e instanceof AdLibraryBlockedError) blocked = e;
        } finally {
          await dp.close().catch(() => {});
          progress(`Copy ${++done}/${detailIds.length}`);
        }
        if (pageDelayMs && !blocked && idx < detailIds.length) await sleep(pageDelayMs);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, detailIds.length) }, worker));
    if (blocked) {
      blocked.partialCopy = out;
      throw blocked;
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

/* --------------------------------- the scan --------------------------------- */

/**
 * Collect a competitor's ads from the public LinkedIn Ad Library and (by
 * default) enrich each with its transparency detail. Synthesis of themes is
 * left to the caller — this returns clean structured data to analyze.
 */
export async function scanAdLibrary(opts: AdLibraryScanOptions): Promise<AdLibraryScan> {
  if (!opts.advertiser && !opts.companyId && !opts.keyword) {
    throw new Error("Provide an advertiser name, companyId, or keyword to scan.");
  }
  const max = opts.max ?? 50;
  const deep = opts.deep ?? true;
  const concurrency = Math.max(1, opts.concurrency ?? SCRAPER_DEFAULTS.concurrency);
  const pageDelayMs = Math.max(0, opts.pageDelayMs ?? SCRAPER_DEFAULTS.pageDelayMs);
  const copyMax = Math.max(0, opts.copyMax ?? SCRAPER_DEFAULTS.copyMax);
  const headless = opts.headless ?? true;
  const progress = opts.onProgress ?? (() => {});
  const searchUrl = buildSearchUrl(opts);

  const browser = await launchBrowser(headless);
  try {
    const ctx = await browser.newContext({ userAgent: DESKTOP_UA, viewport: { width: 1280, height: 1600 } });
    const page = await ctx.newPage();
    progress(`Opening ${searchUrl}`);
    await gotoOrThrowIfBlocked(page, searchUrl, 0, "the Ad Library search page");
    await page.waitForTimeout(2500);

    // Total reported count, e.g. "9,081 ads".
    let totalReported: number | undefined;
    try {
      const body = await page.evaluate(() => (document.body as HTMLElement).innerText);
      const t = body.match(/([\d,]+)\s+ads?\b/i);
      if (t?.[1]) totalReported = Number(t[1].replace(/,/g, ""));
    } catch {
      /* ignore */
    }

    // Scroll + "See more" until we hit `max` or the count stops growing.
    const countCards = () =>
      page.$$eval('a[href*="/ad-library/detail/"]', (as) => {
        const ids = new Set<string>();
        for (const a of as) {
          const id = a.getAttribute("href")?.match(/detail\/(\d+)/)?.[1];
          if (id && id !== "12345678") ids.add(id);
        }
        return ids.size;
      });

    let count = await countCards();
    let stale = 0;
    for (let i = 0; i < 80 && count < max && stale < 3; i++) {
      await page.mouse.wheel(0, 24000);
      await page.waitForTimeout(1200);
      const btn = await page.$('button:has-text("See more"), button:has-text("Show more")');
      if (btn) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(1400);
      }
      const next = await countCards();
      if (next <= count) stale++;
      else stale = 0;
      count = next;
      progress(`Loaded ${count} ads...`);
    }

    let cards = (await page.evaluate(extractCardsInPage)) as AdLibraryCard[];
    cards = cards.slice(0, max);
    progress(`Collected ${cards.length} ad cards.`);

    const ads: AdLibraryAd[] = cards.map((c) => ({ ...c }));

    let note: string | undefined;
    if (deep && ads.length) {
      const detailAds = ads.slice(0, copyMax);
      if (detailAds.length < ads.length) {
        note = `Detail pages capped at ${detailAds.length} of ${ads.length} ads (each is a browser visit from your IP); raise copyMax deliberately for more.`;
      }
      progress(`Fetching transparency detail for ${detailAds.length} ads (concurrency ${concurrency})...`);
      let idx = 0;
      let done = 0;
      let blocked: AdLibraryBlockedError | undefined;
      const worker = async () => {
        while (idx < detailAds.length && !blocked) {
          const my = idx++;
          const ad = detailAds[my];
          if (!ad) continue;
          const dp = await ctx.newPage();
          try {
            await gotoOrThrowIfBlocked(dp, ad.detailUrl, done, "an ad detail page");
            await dp.waitForTimeout(2200);
            const raw = (await dp.evaluate(extractDetailInPage)) as {
              innerText: string;
              creativeType?: string;
              headline?: string;
              cta?: string;
            };
            const detail = parseDetail(raw.innerText, raw.creativeType ?? ad.format);
            if (raw.headline) detail.headline = raw.headline;
            if (raw.cta) detail.cta = raw.cta;
            ad.detail = detail;
          } catch (e) {
            // A block ends the run and keeps the cards; anything else is one flaky page.
            if (e instanceof AdLibraryBlockedError) blocked = e;
          } finally {
            await dp.close().catch(() => {});
            done++;
          }
          if (pageDelayMs && !blocked && idx < detailAds.length) await sleep(pageDelayMs);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, detailAds.length) }, worker));
      if (blocked) {
        progress(blocked.message);
        note = [note, blocked.message].filter(Boolean).join(" ");
      } else {
        progress("Detail fetch complete.");
      }
    }

    return {
      query: {
        advertiser: opts.advertiser,
        companyId: opts.companyId,
        keyword: opts.keyword,
        countries: opts.countries,
        url: searchUrl,
      },
      totalReported,
      fetched: ads.length,
      note,
      ads,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
