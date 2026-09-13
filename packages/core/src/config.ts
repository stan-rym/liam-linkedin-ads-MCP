import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  LIADS_DIR,
  EnvCredentialStore,
  FileCredentialStore as SharedFileCredentialStore,
  type CredentialStore,
  type StoredCredentials,
} from "@liads/shared";

// Re-exported so every existing `import { ... } from "@liads/core"` keeps working
// now that the credential layer lives in the shared package.
export { LIADS_DIR, EnvCredentialStore };
export type { CredentialStore, StoredCredentials };

const CONFIG_PATH = join(LIADS_DIR, "config.json");
const CREDENTIALS_PATH = join(LIADS_DIR, "credentials.json");

/** Default LinkedIn API version (YYYYMM). Pinned; bump deliberately. */
export const DEFAULT_LINKEDIN_VERSION = "202605";

/** OAuth callback the local login server listens on. Must match the app's redirect URL. */
export const OAUTH_REDIRECT_URI = "http://localhost:53682/callback";

export interface AppConfig {
  clientId: string;
  clientSecret: string;
  /** YYYYMM. Falls back to DEFAULT_LINKEDIN_VERSION. */
  linkedinVersion?: string;
  /** Numeric ad account id used when a command/brief omits one. */
  defaultAccountId?: string;
  /** Conversion name auto-selected for new campaigns when none is specified. */
  defaultConversionName?: string;
  /**
   * Conversion names auto-selected for new campaigns when none is specified.
   * Takes precedence over defaultConversionName; every listed conversion is
   * attached. Use resolveDefaultConversionNames() to read the effective list.
   */
  defaultConversionNames?: string[];
}

/**
 * Effective list of default conversion names to attach to new campaigns:
 * defaultConversionNames if set, else the single defaultConversionName, else [].
 */
export function resolveDefaultConversionNames(config: AppConfig): string[] {
  if (config.defaultConversionNames?.length) return config.defaultConversionNames;
  return config.defaultConversionName ? [config.defaultConversionName] : [];
}

/**
 * Per-request credentials for the hosted multi-tenant path: a caller brings
 * their own LinkedIn app + refresh token in request headers, and the HTTP
 * handler runs the request inside `withRequestCredentials`. Everything below
 * (loadConfig, resolveCredentialStore) checks this context first, so the same
 * tool code serves the env-configured tenant and header-credentialed callers.
 */
export interface RequestCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  linkedinVersion?: string;
  defaultAccountId?: string;
}

const requestCredentials = new AsyncLocalStorage<RequestCredentials>();

/** Runs fn with the given caller credentials active for every nested call. */
export function withRequestCredentials<T>(creds: RequestCredentials, fn: () => T): T {
  return requestCredentials.run(creds, fn);
}

/** The caller credentials active for the current request, if any. */
export function activeRequestCredentials(): RequestCredentials | undefined {
  return requestCredentials.getStore();
}

/**
 * Loads app config. Prefers per-request credentials (hosted multi-tenant),
 * then environment variables (hosted / Vercel single tenant), then
 * ~/.liads/config.json (local CLI and self-host).
 */
export async function loadConfig(): Promise<AppConfig> {
  const reqCreds = activeRequestCredentials();
  if (reqCreds) {
    return {
      clientId: reqCreds.clientId,
      clientSecret: reqCreds.clientSecret,
      linkedinVersion: reqCreds.linkedinVersion,
      defaultAccountId: reqCreds.defaultAccountId,
    };
  }
  if (process.env.LIADS_CLIENT_ID && process.env.LIADS_CLIENT_SECRET) {
    return {
      clientId: process.env.LIADS_CLIENT_ID,
      clientSecret: process.env.LIADS_CLIENT_SECRET,
      linkedinVersion: process.env.LIADS_LINKEDIN_VERSION,
      defaultAccountId: process.env.LIADS_DEFAULT_ACCOUNT_ID,
    };
  }
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf8");
  } catch {
    throw new Error(
      `No credentials. Set LIADS_CLIENT_ID/LIADS_CLIENT_SECRET env vars, or create ${CONFIG_PATH} with { "clientId", "clientSecret", "linkedinVersion" }.`,
    );
  }
  const parsed = JSON.parse(raw) as AppConfig;
  if (!parsed.clientId || !parsed.clientSecret) {
    throw new Error(`${CONFIG_PATH} must include clientId and clientSecret.`);
  }
  return parsed;
}

export function linkedinVersion(config: AppConfig): string {
  return config.linkedinVersion ?? DEFAULT_LINKEDIN_VERSION;
}

/** Resolves the default ad account id from config, or throws if none is set. */
export async function requireDefaultAccountId(): Promise<string> {
  const { defaultAccountId } = await loadConfig();
  if (!defaultAccountId) {
    throw new Error("No account id provided and no defaultAccountId in config.");
  }
  return defaultAccountId;
}

/** LinkedIn's local token file at ~/.liads/credentials.json (mode 0600). */
export class FileCredentialStore extends SharedFileCredentialStore {
  constructor() {
    super(CREDENTIALS_PATH);
  }
}

/**
 * Store for header-credentialed callers. Access tokens derived from a caller's
 * refresh token are cached in module memory (keyed by that refresh token) so
 * repeat calls within a warm instance don't re-hit LinkedIn's token endpoint.
 * Nothing is ever written to disk.
 */
const requestTokenCache = new Map<string, StoredCredentials>();
const REQUEST_TOKEN_CACHE_MAX = 100;

export class RequestCredentialStore implements CredentialStore {
  constructor(private readonly refreshToken: string) {}
  async load(): Promise<StoredCredentials | null> {
    return (
      requestTokenCache.get(this.refreshToken) ?? {
        accessToken: "",
        refreshToken: this.refreshToken,
        expiresAt: 0,
      }
    );
  }
  async save(creds: StoredCredentials): Promise<void> {
    if (requestTokenCache.size >= REQUEST_TOKEN_CACHE_MAX) {
      const oldest = requestTokenCache.keys().next().value;
      if (oldest !== undefined) requestTokenCache.delete(oldest);
    }
    requestTokenCache.set(this.refreshToken, creds);
  }
}

/**
 * Picks the store matching where credentials came from: per-request headers,
 * then the env refresh token, else the local file.
 */
export function resolveCredentialStore(): CredentialStore {
  const reqCreds = activeRequestCredentials();
  if (reqCreds) {
    return new RequestCredentialStore(reqCreds.refreshToken);
  }
  if (process.env.LIADS_REFRESH_TOKEN) {
    return new EnvCredentialStore(process.env.LIADS_REFRESH_TOKEN);
  }
  return new FileCredentialStore();
}
