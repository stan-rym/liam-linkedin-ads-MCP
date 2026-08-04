import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  /** Epoch ms when the refresh token expires, if known. */
  refreshExpiresAt?: number;
  scope?: string;
}

/**
 * Abstraction over where OAuth tokens live, so the same auth logic serves the
 * local CLI (file-backed) and a hosted server (env-seeded, memory-backed).
 */
export interface CredentialStore {
  load(): Promise<StoredCredentials | null>;
  save(creds: StoredCredentials): Promise<void>;
}

/** Local file store (mode 0600). Each platform passes its own path. */
export class FileCredentialStore implements CredentialStore {
  constructor(private readonly path: string) {}
  async load(): Promise<StoredCredentials | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as StoredCredentials;
    } catch {
      return null;
    }
  }
  async save(creds: StoredCredentials): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(creds, null, 2), { mode: 0o600 });
  }
}

/**
 * Hosted store: seeded from a long-lived refresh token in the environment. The
 * access token is derived at runtime and cached in memory only, so the server
 * stays stateless and no token is persisted back to the environment.
 */
export class EnvCredentialStore implements CredentialStore {
  private memory: StoredCredentials | null = null;
  constructor(private readonly refreshToken: string) {}
  async load(): Promise<StoredCredentials | null> {
    if (this.memory) return this.memory;
    // Expired access token forces an immediate refresh from the seed refresh token.
    return { accessToken: "", refreshToken: this.refreshToken, expiresAt: 0 };
  }
  async save(creds: StoredCredentials): Promise<void> {
    this.memory = creds;
  }
}
