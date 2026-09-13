import type { GoogleAdsClient } from "../http.js";
import { search, gaqlString } from "../gaql.js";

/**
 * Geo and language targeting constants.
 *
 * Both are queryable resources rather than hard-coded tables, so "US" and "en"
 * resolve against the live API instead of a list in this repo that quietly goes
 * stale. Results are memoized per process: a launch resolves the same country
 * several times and these never change within a run.
 */

const geoCache = new Map<string, string>();
const languageCache = new Map<string, string>();

/**
 * Resolve a location to a `geoTargetConstants/<id>` resource name. Accepts an
 * ISO country code ("US"), a raw numeric id ("2840"), or an already-formed
 * resource name.
 */
export async function resolveGeoTarget(client: GoogleAdsClient, customerId: string, location: string): Promise<string> {
  if (location.startsWith("geoTargetConstants/")) return location;
  if (/^\d+$/.test(location)) return `geoTargetConstants/${location}`;

  const key = location.toUpperCase();
  const cached = geoCache.get(key);
  if (cached) return cached;

  const rows = await search(
    client,
    customerId,
    `SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.country_code
     FROM geo_target_constant
     WHERE geo_target_constant.country_code = ${gaqlString(key)}
       AND geo_target_constant.target_type = 'Country'
       AND geo_target_constant.status = 'ENABLED'
     LIMIT 1`,
  );
  const id = rows[0]?.geoTargetConstant?.id;
  if (!id) {
    throw new Error(
      `Could not resolve location "${location}" to a geo target. Use an ISO country code (US, GB) or a numeric geoTargetConstant id.`,
    );
  }
  const resourceName = `geoTargetConstants/${id}`;
  geoCache.set(key, resourceName);
  return resourceName;
}

/** Resolve a language to a `languageConstants/<id>` resource name. Accepts "en", an id, or a resource name. */
export async function resolveLanguage(client: GoogleAdsClient, customerId: string, language: string): Promise<string> {
  if (language.startsWith("languageConstants/")) return language;
  if (/^\d+$/.test(language)) return `languageConstants/${language}`;

  const key = language.toLowerCase();
  const cached = languageCache.get(key);
  if (cached) return cached;

  const rows = await search(
    client,
    customerId,
    `SELECT language_constant.id, language_constant.code, language_constant.name
     FROM language_constant
     WHERE language_constant.code = ${gaqlString(key)} AND language_constant.targetable = TRUE
     LIMIT 1`,
  );
  const id = rows[0]?.languageConstant?.id;
  if (!id) {
    throw new Error(`Could not resolve language "${language}". Use an ISO code such as "en".`);
  }
  const resourceName = `languageConstants/${id}`;
  languageCache.set(key, resourceName);
  return resourceName;
}
