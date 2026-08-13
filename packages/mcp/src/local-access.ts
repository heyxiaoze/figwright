/**
 * Who may talk to the leader's relay endpoints.
 *
 * By default the relay binds 127.0.0.1, which keeps the LAN out; it does not keep the user's own
 * browser out. Two distinct paths lead from a web page to a local port, and they need two distinct
 * checks:
 *
 * - **Cross-site.** A page can open a WebSocket to a local port (WebSockets have no same-origin
 *   policy) or POST a CORS "simple request" to one. It can't read the reply, but the side effect
 *   already happened. Such a request carries an `Origin` the page cannot forge → gated by origin.
 * - **DNS rebinding.** A page on attacker.com whose DNS re-resolves to our address reaches us as
 *   _same-origin_, so a GET carries no `Origin` at all and the reply IS readable. What it cannot
 *   change is `Host`, which still names the attacker's domain → gated by host.
 *
 * The MCP security best practices ("Local MCP Server Compromise") name DNS rebinding explicitly;
 * the host gate follows the shape Playwright uses for its own local servers.
 *
 * LAN mode. When the server is configured to bind a non-loopback host (`FIGWRIGHT_HOST`), the
 * loopback assumption no longer holds: a rogue machine on the same network could address us by one
 * of our interface IPs. Two things change, and both are deliberate:
 *
 * - `isAllowedHost` becomes conditional (see below): loopback binding keeps the strict loopback
 *   allow-list; a LAN binding admits our own interface addresses too, preserving the DNS-rebinding
 *   defence (the attacker still can't make `Host` name *our* IP) while letting legitimate LAN clients
 *   through.
 * - The loopback boundary is replaced by a shared token — see `relay.verifyClient` and
 *   `relay.handleHello`, which require `FIGWRIGHT_TOKEN` on every WebSocket upgrade and `$hello`.
 *   Opening a port to the LAN without that token would be unsafe.
 */

import { networkInterfaces } from 'node:os';

/**
 * Figma renders plugin UI in a sandboxed iframe, whose serialized origin is the literal string
 * "null". The www/apex pair is belt-and-braces for a host that ever sends a real origin instead.
 */
const PLUGIN_ORIGINS = new Set(['null', 'https://www.figma.com', 'https://figma.com']);

/** The names a legitimate caller can address us by when bound to loopback. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Collect every address this machine actually answers on, as host-header-able hostnames. When the
 * relay binds a non-loopback host the loopback assumption is gone, so a client addressing us by any
 * of our own interface IPs (IPv4 or IPv6) must be admitted — that is still "us", not a DNS-rebinding
 * attacker (who can only make Host name *their* domain). Internal (loopback) and link-local
 * (169.254/fe80) addresses are filtered: loopback is already covered, and link-local is not a stable
 * LAN identity to connect to. Called per request (cheap) so a hot-plugged NIC takes effect without a
 * restart.
 */
export const localInterfaceHosts = (): Set<string> => {
  const hosts = new Set<string>();
  for (const list of Object.values(networkInterfaces())) {
    if (list === undefined) continue;
    for (const ni of list) {
      if (ni.internal) continue;
      // Skip link-local: not a usable LAN identity and only adds noise to the allow set.
      if (ni.cidr != null && (ni.cidr.startsWith('169.254.') || ni.cidr.startsWith('fe80')))
        continue;
      hosts.add(ni.address);
    }
  }
  return hosts;
};

/** True when `host` is a loopback name the server may have bound to. */
export const isLoopbackHost = (host: string): boolean => LOOPBACK_HOSTS.has(host.toLowerCase());

/**
 * Escape hatch for an environment whose plugin host sends an origin we don't anticipate. Read per
 * call rather than at module load so tests (and a user editing their client config) see changes.
 * Deliberately does not lift the host gate: that set is our own bind address, not something an
 * outside party influences, so there is nothing for it to break.
 */
const allowAnyOrigin = (): boolean => process.env.FIGWRIGHT_ALLOW_ANY_ORIGIN === '1';

/** Strip the port, keeping an IPv6 literal's brackets intact. */
const hostnameFromHostHeader = (host: string): string => {
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end < 0 ? host : host.slice(0, end + 1);
  }
  const colon = host.indexOf(':');
  return colon < 0 ? host : host.slice(0, colon);
};

/**
 * True when the request addressed us by a name we actually bound to. Blocks DNS rebinding, where the
 * browser treats the call as same-origin — so no `Origin` is sent and the reply is readable — but
 * `Host` still carries the attacker's domain.
 *
 * Conditional on the bind host:
 *
 * - **Loopback bind** (the default, `127.0.0.1`) — only the strict loopback allow-list is admitted,
 *   exactly as before LAN mode existed.
 * - **LAN bind** (`FIGWRIGHT_HOST` set to a non-loopback host) — the loopback set is widened to
 *   include this machine's own interface addresses, so a peer on the network addressing us by our IP
 *   is admitted while a rebinding attacker (Host = their domain) is still refused. The token gate in
 *   `relay` is what actually authenticates those LAN peers.
 *
 * `bindHost` is the host the relay was told to bind (`NodeOptions.host`). When it is `0.0.0.0` the
 * socket answers on every interface, so we admit all interface addresses rather than the wildcard
 * itself (a client never sends `Host: 0.0.0.0`).
 */
export const isAllowedHost = (host: string | undefined, bindHost?: string): boolean => {
  // HTTP/1.1 requires Host; a caller omitting it is not a browser following the rules.
  if (host === undefined || host === '') return false;
  const hostname = hostnameFromHostHeader(host.toLowerCase());

  // Loopback bind keeps the strict behaviour — no widening, no interface scan.
  if (bindHost === undefined || isLoopbackHost(bindHost)) {
    return LOOPBACK_HOSTS.has(hostname);
  }

  // LAN bind: admit loopback names (a same-machine follower/curl still works) plus our own
  // interface addresses, plus the explicit bind host itself when it is a concrete address.
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  if (hostname === hostnameFromHostHeader(bindHost.toLowerCase())) return true;
  return localInterfaceHosts().has(hostname);
};

/** True when a WebSocket upgrade carrying this `Origin` may become a plugin session. */
export const isAllowedWsOrigin = (origin: string | undefined): boolean => {
  if (allowAnyOrigin()) return true;
  // Absent header: a non-browser client (the desktop app's plugin host, a test harness). Browsers
  // always set Origin on a WebSocket handshake, so this can't be a web page.
  if (origin === undefined || origin === '') return true;
  return PLUGIN_ORIGINS.has(origin);
};

/**
 * True when an HTTP request carrying this `Origin` may reach /rpc, /ping or /abdicate. Stricter
 * than the WebSocket rule on purpose: only followers call these, over Node's fetch, which never
 * sets Origin. Anything that does set it is a browser, and no browser has business here — including
 * one pointed at figma.com. A user opening http://127.0.0.1:3055/ping in a tab still works, because
 * top-level navigations send no Origin.
 */
export const isAllowedHttpOrigin = (origin: string | undefined): boolean => {
  if (allowAnyOrigin()) return true;
  return origin === undefined || origin === '';
};

/**
 * True when `header` names exactly `expected`, ignoring parameters (`; charset=…`) and case.
 *
 * Defence in depth behind the origin check: the CORS "simple request" forms a page can send without
 * a preflight are limited to text/plain, form-urlencoded and multipart. Demanding a media type
 * outside that set means a cross-origin POST must preflight, and the preflight fails — we answer no
 * CORS headers at all.
 */
export const hasContentType = (header: string | undefined, expected: string): boolean => {
  if (header === undefined) return false;
  const [type] = header.split(';');
  return type?.trim().toLowerCase() === expected;
};
