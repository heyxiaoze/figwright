import { randomBytes } from 'node:crypto';

/**
 * Multi-token registry for the LAN / remote-MCP boundary.
 *
 * A single shared `FIGWRIGHT_TOKEN` (the historical model) means every peer — every teammate's
 * VSCode on the LAN — authenticates with the *same* secret, and you can't tell them apart or revoke
 * one without revoking all. This module lets the operator issue several named tokens, each optionally
 * pinned to read-only, and the relay / remote-MCP handler accept *any* of them.
 *
 * Backward compatible: a lone `FIGWRIGHT_TOKEN` still works (it becomes a single-entry registry), and
 * the LAN auto-generated token path is preserved when no token is configured at all.
 */

export interface TokenEntry {
  /** The secret presented by the peer as a WebSocket subprotocol / `x-figwright-token` / Bearer. */
  value: string;
  /** Operator-facing label shown in audit logs and the dashboard (e.g. "Alice 的 VSCode"). */
  label?: string;
  /**
   * Per-token permission override. When `true` the connection is forced read-only even if the server
   * runs read-write. When `false`/`undefined` the server-wide `FIGWRIGHT_READONLY` governs. This is
   * how one peer (e.g. a reviewer) gets read-only while another (a co-author) gets read+write.
   */
  readonly?: boolean;
}

export interface TokenInfo {
  value: string;
  label: string;
  /** Effective read-only for this connection, folding in the server-wide flag. */
  readonly: boolean;
}

export class TokenRegistry {
  private readonly byValue = new Map<string, TokenEntry>();

  constructor(entries: TokenEntry[]) {
    for (const e of entries) {
      if (e.value) this.byValue.set(e.value, e);
    }
  }

  /** Match a presented secret; returns its resolved info or null. */
  match(presented: string | undefined, serverReadonly: boolean): TokenInfo | null {
    if (presented === undefined) return null;
    const entry = this.byValue.get(presented);
    if (entry === undefined) return null;
    return {
      value: entry.value,
      label: entry.label ?? 'token',
      readonly: entry.readonly ?? serverReadonly,
    };
  }

  has(value: string): boolean {
    return this.byValue.has(value);
  }

  values(): string[] {
    return [...this.byValue.keys()];
  }

  list(): TokenEntry[] {
    return [...this.byValue.values()];
  }

  /** The display token for connection guides (plugin invite / mcp-remote command). Prefers an
   * explicitly-labelled "primary", then any entry, so guides stay stable across restarts. */
  primary(): TokenEntry | undefined {
    const all = this.list();
    return all.find(e => e.label === 'primary') ?? all[0];
  }
}

export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface BuildTokenRegistryOpts {
  /** Legacy single-token env (`FIGWRIGHT_TOKEN`). */
  legacyToken?: string;
  /** JSON-array env (`FIGWRIGHT_TOKENS`) of TokenEntry. Takes precedence over legacyToken. */
  tokensJson?: string;
  /** Auto-generated LAN token (when no token configured). Only used if nothing else is set. */
  autoToken?: string;
  /** Server-wide read-only flag, folded into each token's effective readonly. */
  serverReadonly: boolean;
}

export function buildTokenRegistry(opts: BuildTokenRegistryOpts): TokenRegistry {
  const entries: TokenEntry[] = [];
  if (opts.tokensJson) {
    try {
      const parsed = JSON.parse(opts.tokensJson);
      if (Array.isArray(parsed)) {
        for (const e of parsed) {
          if (e && typeof e.value === 'string' && e.value.length > 0) {
            entries.push({
              value: e.value,
              label: typeof e.label === 'string' ? e.label : undefined,
              readonly: typeof e.readonly === 'boolean' ? e.readonly : undefined,
            });
          }
        }
      }
    } catch {
      // A malformed tokens array must never silently let an unauthenticated relay onto the LAN,
      // so on parse failure we fall through to the legacy/auto paths below rather than starting empty.
    }
  }
  if (entries.length === 0 && opts.legacyToken) {
    entries.push({ value: opts.legacyToken, label: 'primary' });
  }
  if (entries.length === 0 && opts.autoToken) {
    entries.push({ value: opts.autoToken, label: 'auto-generated' });
  }
  return new TokenRegistry(entries);
}
