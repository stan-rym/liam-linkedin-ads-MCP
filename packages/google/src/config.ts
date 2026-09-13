import { join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  LIADS_DIR,
  EnvCredentialStore,
  FileCredentialStore,
  type CredentialStore,
} from "@liads/shared";

/**
 * Google Ads config lives alongside LinkedIn's in ~/.liads rather than in a
 * directory of its own: one place holds every credential this tool stores, and
 * the change journal at the root already spans both platforms. The directory
 * name is frozen (see AGENTS.md).
 */
const CONFIG_PATH = join(LIADS_DIR, "google.json");
const CREDENTIALS_PATH = join(LIADS_DIR, "google-credentials.json");

/**
 * Google Ads API version. Pinned deliberately: major versions carry breaking
 * changes (v24 renamed campaign.start_date to start_date_time) and each is
 * supported for roughly a year, so bumping is a decision, not a default.
 */
export const DEFAULT_API_VERSION = "v25";

/** OAuth callback for the local login server. A Google "Desktop app" client accepts any localhost port. */
export const OAUTH_REDIRECT_URI = "http://localhost:53683/callback";
export const OAUTH_CALLBACK_PORT = 53683;

export interface GoogleAdsConfig {
  clientId: string;
  clientSecret: string;
  /**
   * From the manager account's API Center. Required on every call unless the
   * Cloud-managed access pilot is enabled for this org.
   */
  developerToken: string;
  /**
   * The manager (MCC) customer id, digits only. Sent as `login-customer-id`.
   * Only needed when the OAuth user reaches the target account through a
   * manager rather than owning it directly.
   */
  loginCustomerId?: string;
  /** Customer id used when a command or brief omits one. Digits only. */
  defaultCustomerId?: string;
  /** Falls back to DEFAULT_API_VERSION. */
  apiVersion?: string;
  /**
   * Conversion action names attached to new campaigns when a brief names none.
   * Mirrors LinkedIn's defaultConversionNames.
   */
  defaultConversionActionNames?: string[];
}

/** Strip formatting from a customer id: Google rejects "123-456-7890". */
export const normalizeCustomerId = (id: string): string => id.replace(/\D/g, "");

/**
 * Loads Google Ads config. Environment variables first (hosted / CI), then
 * ~/.liads/google.json (local CLI).
 */
export async function loadGoogleConfig(): Promise<GoogleAdsConfig> {
  if (process.env.GADS_CLIENT_ID && process.env.GADS_CLIENT_SECRET) {
    return {
      clientId: process.env.GADS_CLIENT_ID,
      clientSecret: process.env.GADS_CLIENT_SECRET,
      developerToken: process.env.GADS_DEVELOPER_TOKEN ?? "",
      loginCustomerId: process.env.GADS_LOGIN_CUSTOMER_ID,
      defaultCustomerId: process.env.GADS_DEFAULT_CUSTOMER_ID,
      apiVersion: process.env.GADS_API_VERSION,
    };
  }
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(
      `No Google Ads credentials. Create ${CONFIG_PATH} with { "clientId", "clientSecret", "developerToken", "loginCustomerId", "defaultCustomerId" }, or set GADS_CLIENT_ID / GADS_CLIENT_SECRET / GADS_DEVELOPER_TOKEN.`,
    );
  }
  const parsed = JSON.parse(raw) as GoogleAdsConfig;
  if (!parsed.clientId || !parsed.clientSecret) {
    throw new Error(`${CONFIG_PATH} must include clientId and clientSecret.`);
  }
  return parsed;
}

export function apiVersion(config: GoogleAdsConfig): string {
  return config.apiVersion ?? DEFAULT_API_VERSION;
}

/** Resolve the customer id to act on, or throw if neither given nor configured. */
export async function requireCustomerId(customerId?: string): Promise<string> {
  if (customerId) return normalizeCustomerId(customerId);
  const { defaultCustomerId } = await loadGoogleConfig();
  if (!defaultCustomerId) {
    throw new Error("No customerId provided and no defaultCustomerId in ~/.liads/google.json.");
  }
  return normalizeCustomerId(defaultCustomerId);
}

/** Effective list of conversion action names to attach to new campaigns. */
export function resolveDefaultConversionActionNames(config: GoogleAdsConfig): string[] {
  return config.defaultConversionActionNames ?? [];
}

/** Local token file, or an env-seeded memory store on a hosted deploy. */
export function resolveGoogleCredentialStore(): CredentialStore {
  if (process.env.GADS_REFRESH_TOKEN) {
    return new EnvCredentialStore(process.env.GADS_REFRESH_TOKEN);
  }
  return new FileCredentialStore(CREDENTIALS_PATH);
}

export const googleCredentialsPath = CREDENTIALS_PATH;
export const googleConfigPath = CONFIG_PATH;
