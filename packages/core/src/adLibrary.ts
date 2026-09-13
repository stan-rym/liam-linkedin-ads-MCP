/** Public Ad Library types and parsers. Browser collection lives only in the remote worker. */
const AD_LIBRARY_BASE = "https://www.linkedin.com/ad-library";
export const SCRAPER_DEFAULTS = { concurrency: 1, pageDelayMs: 15000, copyMax: 10 } as const;
export interface AdCopy {
  commentary?: string;
  imageUrl?: string;
  headline?: string;
  cta?: string;
  screenshotPath?: string;
  collectedAt?: string;
}
export class AdLibraryBlockedError extends Error {
  readonly pagesFetched: number;
  partialCopy?: Map<string, AdCopy>;
  constructor(pagesFetched: number, where: string) {
    super(`LinkedIn blocked this IP while opening ${where}. Collection is disabled; do not retry. An operator must review the worker before resuming.`);
    this.name = "AdLibraryBlockedError";
    this.pagesFetched = pagesFetched;
  }
}
export function isBlockedPage(status: number | undefined, title: string, bodyText: string): boolean {
  return status === 403 || status === 429 || status === 503 ||
    /attention required!?\s*\|\s*cloudflare/i.test(title) ||
    /just a moment/i.test(title) ||
    /sorry, you have been blocked|verify you are human|checking your browser/i.test(bodyText);
}
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
  creativeStatus?: string;
  collectedAt?: string;
  screenshotUrl?: string;
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
  /** Pause between detail pages per worker in ms (default 15000). */
  pageDelayMs?: number;
  /** Most ads to open detail pages for in one run (default 10). */
  copyMax?: number;
  /** Deprecated compatibility field; local browser collection is disabled. */
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


/** Local browser entry points intentionally fail closed, including direct core callers. */
export async function scanAdLibrary(_opts: AdLibraryScanOptions): Promise<AdLibraryScan> {
  throw new Error("Local Ad Library scraping is disabled. Use the official API and remote creative worker.");
}
export async function fetchAdCopyByIds(_ids: string[], _opts = {}): Promise<Map<string, AdCopy>> {
  throw new Error("Local Ad Library scraping is disabled. Use the remote creative worker.");
}
