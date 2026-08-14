import type { ConnectionSettings } from '../../protocol/panel-control.js';

/**
 * The single copy-pasteable connection string the server prints in LAN mode. The operator hands it
 * to the plugin user, who pastes it into Settings → "粘贴邀请" to auto-fill host/port instead of
 * transcribing them by hand. No token is included: the plugin connects over loopback, which is its
 * own boundary (see relay.ts).
 */
export const INVITE_PREFIX = 'figwright://connect?';

export interface ParsedInvite {
  host: string;
  port: number;
}

/**
 * Parse a figwright invite string into connection fields, or null when the input isn't a valid
 * invite. Tolerant of surrounding whitespace and of query-param order.
 */
export const parseInvite = (raw: string): ParsedInvite | null => {
  const s = raw.trim();
  if (!s.startsWith(INVITE_PREFIX)) return null;
  const params = new URLSearchParams(s.slice(INVITE_PREFIX.length));
  const host = params.get('host');
  const portRaw = params.get('port');
  if (host === null || host.trim() === '') return null;
  if (portRaw === null) return null;
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return null;
  return { host: host.trim(), port };
};

/** Build the copy-pasteable invite string for a set of connection settings. */
export const buildInvite = (s: ConnectionSettings): string =>
  `${INVITE_PREFIX}host=${encodeURIComponent(s.host)}&port=${s.port}`;
