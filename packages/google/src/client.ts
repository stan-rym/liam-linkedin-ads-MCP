import type { TokenProvider } from "@liads/shared";
import { loadGoogleConfig } from "./config.js";
import { createGoogleTokenProvider } from "./auth.js";
import { GoogleAdsClient, type GoogleMutationHook } from "./http.js";
import { recordGoogleMutation } from "./changelog.js";

export interface Gads {
  client: GoogleAdsClient;
  getToken: TokenProvider;
}

/**
 * Builds a ready-to-use Google Ads client: loads config, wires the
 * auto-refreshing token provider, and journals every write. Throws a clear
 * error if not yet authenticated.
 */
export async function createGads(): Promise<Gads> {
  const config = await loadGoogleConfig();
  if (!config.developerToken) {
    throw new Error(
      "No developer token. Add `developerToken` to ~/.liads/google.json (get one from your Google Ads manager account at ads.google.com/aw/apicenter) or set GADS_DEVELOPER_TOKEN.",
    );
  }
  const getToken = await createGoogleTokenProvider();
  // Disabled on hosted deploys (read-only filesystem) and whenever LIADS_NO_CHANGELOG is set.
  const journaling = !process.env.GADS_REFRESH_TOKEN && !process.env.LIADS_NO_CHANGELOG;
  const onMutation: GoogleMutationHook | undefined = journaling ? recordGoogleMutation : undefined;
  return { client: new GoogleAdsClient(config, getToken, onMutation), getToken };
}
