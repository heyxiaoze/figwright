// Resource transfer layer for remote partners.
//
// When the MCP server is configured with a WebDAV/SFTP transfer target, every exported image is
// *staged* to that store (credentials live only on the server) and a one-time token is minted. The
// save_* tool result carries the token instead of — or alongside — the server's local `path`, so a
// remote partner agent can call fetch_asset(token) to pull the bytes over the existing MCP
// connection (works through the mcp-remote tunnel too). The server fetches the file from staging
// with its own stored credentials, returns it, and deletes the staged copy. Credentials never reach
// the partner; the partner only ever sees the token. Inline mode (default) does no staging and the
// save tools fall back to returning `base64` directly.

import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

export type TransferMode = 'inline' | 'webdav' | 'sftp';

/**
 * Carried in the `note` field of save_* results ONLY when a transfer target is active. This is the
 * in-result nudge that tells a remote partner agent (in the tool output it actually reads) how to
 * retrieve the bytes — so it never has to be relayed manually. Base64 is intentionally omitted in
 * this mode; the partner must call fetch_asset(token) and must NOT read `path` (server-side only).
 */
export const ASSET_TOKEN_RESULT_NOTE =
  'REMOTE TRANSFER MODE: base64 is OMITTED from this result (to keep responses small). For every ' +
  'image that carries an `assetToken`, you MUST call fetch_asset({ token }) to pull its bytes over ' +
  'the MCP connection, then write them into your OWN machine\'s asset directory. Do NOT use the ' +
  '`path` field — it is a server-side filesystem path and is unreachable from your machine. Only ' +
  'when `assetToken` is ABSENT (inline mode) is `base64` returned.';

/**
 * Carried in the `note` field of save_* results ONLY when direct-delivery mode is active. Tells the
 * partner agent to GET the `assetUrl` directly (zero base64 over MCP) rather than reading `path` or
 * expecting `base64`/`assetToken`.
 */
export const ASSET_URL_RESULT_NOTE =
  'REMOTE TRANSFER MODE (direct delivery): base64 is OMITTED from this result. Each image carries an ' +
  '`assetUrl` — an HTTP(S) URL you can GET directly to download the file bytes, then write them into ' +
  'your OWN machine\'s asset directory. Do NOT use the `path` field (server-side only) and do NOT ' +
  'expect `base64` or `assetToken`. The URL stays valid for ~10 minutes. Only when `assetUrl` is ' +
  'ABSENT (inline mode) is `base64` returned.';

export interface WebDavConfig {
  /** WebDAV root, e.g. https://dav.example.com/remote.php/webdav */
  url: string;
  /** Optional sub-folder under the root for staged assets. */
  path?: string;
  username: string;
  password: string;
}

export interface SftpConfig {
  host: string;
  port?: number;
  /** Optional remote directory (absolute) for staged assets. */
  path?: string;
  username: string;
  password: string;
}

export interface TransferConfig {
  mode: TransferMode;
  webdav?: WebDavConfig;
  sftp?: SftpConfig;
  /**
   * Direct-delivery mode. When true AND a `publicBaseUrl` is set, save_* results return a download
   * `assetUrl` (an HTTP(S) URL the partner GETs directly) instead of an `assetToken` + fetch_asset
   * round-trip. The URL rides the server's own MCP port (peer already reaches it), so no extra
   * network exposure and WebDAV/SFTP credentials stay server-side. The binary never crosses MCP as
   * base64 — this is the zero-base64 path.
   */
  directUrl?: boolean;
  /** Base URL the partner uses to reach THIS server, e.g. `http://192.168.1.50:3055`. Used to
   * build `assetUrl` = `${publicBaseUrl}/asset/<token>`. Required for direct-delivery mode. */
  publicBaseUrl?: string;
}

/** A pluggable byte store. Keys are relative to the configured sub-path. */
export interface AssetStore {
  upload(key: string, bytes: Buffer): Promise<void>;
  download(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

const stripSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/** Join a base URL with path segments, tolerating stray slashes. */
const joinUrl = (base: string, ...parts: string[]): string => {
  const head = base.replace(/\/+$/, '');
  const tail = parts.map(stripSlashes).filter(Boolean);
  return [head, ...tail].join('/');
};

/**
 * WebDAV store using the native fetch (WebDAV is plain HTTP). PUT uploads, GET downloads, DELETE
 * cleans up; the parent collection is MKCOL'd best-effort before a PUT so intermediate folders need
 * not pre-exist. Zero external dependencies.
 */
export class WebDavStore implements AssetStore {
  private readonly base: string;
  private readonly sub: string;
  private readonly auth: string;

  constructor(cfg: WebDavConfig) {
    this.base = cfg.url.replace(/\/+$/, '');
    this.sub = stripSlashes(cfg.path ?? '');
    this.auth = 'Basic ' + Buffer.from(`${cfg.username}:${cfg.password}`).toString('base64');
  }

  private urlFor(key: string): string {
    return joinUrl(this.base, this.sub, key);
  }

  async upload(key: string, bytes: Buffer): Promise<void> {
    const url = this.urlFor(key);
    const parent = url.slice(0, url.lastIndexOf('/'));
    // Best-effort: create the parent collection; ignore "already exists" (405/409).
    await fetch(parent, { method: 'MKCOL', headers: { Authorization: this.auth } }).catch(() => {});
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: this.auth, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    if (!res.ok) throw new Error(`WebDAV PUT failed: ${res.status} ${res.statusText}`);
  }

  async download(key: string): Promise<Buffer> {
    const res = await fetch(this.urlFor(key), { headers: { Authorization: this.auth } });
    if (!res.ok) throw new Error(`WebDAV GET failed: ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async remove(key: string): Promise<void> {
    // 404 just means it's already gone — not an error worth surfacing.
    await fetch(this.urlFor(key), { method: 'DELETE', headers: { Authorization: this.auth } }).catch(
      () => {},
    );
  }
}

/**
 * SFTP store via ssh2-sftp-client (optional dependency). The import is dynamic so the server runs
 * without it installed — selecting SFTP mode without the package yields a clear runtime error.
 */
export class SftpStore implements AssetStore {
  private readonly cfg: SftpConfig;

  constructor(cfg: SftpConfig) {
    this.cfg = cfg;
  }

  private remotePath(key: string): string {
    const base = stripSlashes(this.cfg.path ?? '');
    return '/' + [base, key].filter(Boolean).join('/');
  }

  private async withClient<T>(fn: (client: any) => Promise<T>): Promise<T> {
    const mod = (await import('ssh2-sftp-client')) as any;
    const client = new mod.default();
    await client.connect({
      host: this.cfg.host,
      port: this.cfg.port ?? 22,
      username: this.cfg.username,
      password: this.cfg.password,
    });
    try {
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  async upload(key: string, bytes: Buffer): Promise<void> {
    await this.withClient(async (client) => {
      const p = this.remotePath(key);
      await client.mkdir(p.slice(0, p.lastIndexOf('/')), true).catch(() => {});
      await client.put(bytes, p);
    });
  }

  async download(key: string): Promise<Buffer> {
    return this.withClient(async (client) => {
      const data = await client.get(this.remotePath(key));
      return Buffer.isBuffer(data) ? data : Buffer.from(await (data as any).read());
    });
  }

  async remove(key: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.delete(this.remotePath(key));
    }).catch(() => {});
  }
}

/** Build the store for a config, or null for inline mode / incomplete credentials. */
export function createAssetStore(cfg: TransferConfig): AssetStore | null {
  if (cfg.mode === 'webdav' && cfg.webdav) return new WebDavStore(cfg.webdav);
  if (cfg.mode === 'sftp' && cfg.sftp) return new SftpStore(cfg.sftp);
  return null;
}

interface StagedEntry {
  key: string;
  name: string;
  expires: number;
}

/**
 * Mints one-time tokens for staged assets and resolves them on fetch. Tokens live only in memory in
 * the leader process and expire after `ttlMs`. Expired staging files are reclaimed by a background
 * sweep (see below) — without it, any token the partner never redeems (e.g. its agent expected
 * inline base64 and never called fetch_asset) would leave its file on WebDAV/SFTP forever.
 */
export class TransferManager {
  private readonly tokens = new Map<string, StagedEntry>();
  private readonly ttlMs: number;
  private readonly sweepTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: AssetStore,
    ttlMs = 10 * 60 * 1000,
  ) {
    this.ttlMs = ttlMs;
    // Proactively reap expired staged files. The token Map entry alone does NOT delete the bytes on
    // the remote store — only fetch_asset(token) does, and partners that never redeem a token (or
    // crash before fetching) would otherwise orphan files indefinitely. Sweeping here guarantees
    // reclamation ~1 min after expiry regardless of partner behaviour. unref so this timer never
    // keeps the event loop (and thus the server process) alive on its own.
    this.sweepTimer = setInterval(() => {
      const now = Date.now();
      for (const [token, entry] of this.tokens) {
        if (entry.expires >= now) continue;
        this.tokens.delete(token);
        void this.store
          .remove(entry.key)
          .then(
            () => process.stderr.write(`[figwright] swept expired staged asset: ${entry.key}\n`),
            () => process.stderr.write(`[figwright] failed to sweep staged asset: ${entry.key}\n`),
          );
      }
    }, 60_000);
    this.sweepTimer.unref?.();
  }

  /** Stop the background sweep (called on shutdown). */
  dispose(): void {
    clearInterval(this.sweepTimer);
  }

  /** Stage bytes and return a one-time token the partner can redeem via fetch_asset. */
  async stage(fileName: string, bytes: Buffer): Promise<string> {
    const id = randomBytes(16).toString('hex');
    const safe = (fileName.replace(/[^\w.-]/g, '_').slice(0, 160) || 'asset').replace(/^_+|_+$/g, '');
    const key = `${id}/${safe}`;
    await this.store.upload(key, bytes);
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, { key, name: fileName || safe, expires: Date.now() + this.ttlMs });
    return token;
  }

  /**
   * Redeem a token: download the staged file, delete it, and return the bytes. Returns null when the
   * token is unknown, already used, or expired (expired entries are swept from staging too).
   */
  async fetch(token: string): Promise<{ bytes: Buffer; name: string } | null> {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    this.tokens.delete(token);
    if (entry.expires < Date.now()) {
      await this.store.remove(entry.key).catch(() => {});
      return null;
    }
    const bytes = await this.store.download(entry.key);
    await this.store.remove(entry.key).catch(() => {});
    return { bytes, name: entry.name };
  }

  /**
   * Non-consuming peek used by the direct-delivery proxy (GET /asset/:token). Returns the bytes
   * WITHOUT deleting the token or staged file, so a partner can retry the download within the TTL
   * (the background sweep still reaps on expiry). Returns null for unknown/expired tokens.
   */
  async peek(token: string): Promise<{ bytes: Buffer; name: string } | null> {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      this.tokens.delete(token);
      await this.store.remove(entry.key).catch(() => {});
      return null;
    }
    const bytes = await this.store.download(entry.key);
    return { bytes, name: entry.name };
  }
}

// Module-level singleton so the pure save_* writers (and fetch_asset) can reach the configured
// manager without threading it through every call. Set once at startup from FIGWRIGHT_TRANSFER.
let manager: TransferManager | null = null;

// Direct-delivery config (parsed from FIGWRIGHT_TRANSFER, not part of the store).
let directUrl = false;
let publicBaseUrl = '';

export function setTransferManager(m: TransferManager | null): void {
  manager = m;
}

export function getTransferManager(): TransferManager | null {
  return manager;
}

/** Whether save_* should return `assetUrl` (direct delivery) instead of `assetToken`. Effective only
 * when a transfer target is active AND both the directUrl flag and a publicBaseUrl are present. */
export function isDirectDelivery(): boolean {
  return manager !== null && directUrl && publicBaseUrl.trim() !== '';
}

/** Base URL the partner uses to reach this server, used to build `assetUrl`. */
export function getPublicBaseUrl(): string {
  return publicBaseUrl;
}

/** Build the partner-facing download URL for a staged token. */
export const buildAssetUrl = (token: string, base: string): string =>
  `${base.replace(/\/+$/, '')}/asset/${token}`;

/** Parse FIGWRIGHT_TRANSFER (JSON) and install the manager singleton. No-op / null on missing or bad input. */
export function initTransferManager(raw: string | undefined): void {
  if (!raw) {
    setTransferManager(null);
    directUrl = false;
    publicBaseUrl = '';
    return;
  }
  try {
    const cfg = JSON.parse(raw) as TransferConfig;
    const store = createAssetStore(cfg);
    setTransferManager(store ? new TransferManager(store) : null);
    directUrl = cfg.directUrl === true;
    publicBaseUrl = typeof cfg.publicBaseUrl === 'string' ? cfg.publicBaseUrl : '';
  } catch {
    setTransferManager(null);
    directUrl = false;
    publicBaseUrl = '';
  }
}
