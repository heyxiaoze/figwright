import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import type { McpServer } from '@modelcontextprotocol/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

import { isAllowedHost, isLoopbackAddress } from './local-access.js';
import type { TokenInfo, TokenRegistry } from './tokens.js';
import { getTransferManager } from './transfer.js';

/**
 * Whether a freshly-opened /mcp session should be read-only.
 *
 * A connection from this same machine (loopback) is always read-write — it is the user's own agent,
 * so the dashboard's read-only setting never restricts it. A remote (LAN) peer defers to the matching
 * token's effective permission (`tokenReadonly`); when the token carries no explicit override it is
 * `undefined` (e.g. a loopback-bind setup with no token), which the caller — `createMcpServer` — then
 * resolves against the server-wide read-only flag. In LAN mode every peer authenticates, so
 * `tokenReadonly` is always a concrete boolean there.
 */
export const connectionReadonly = (clientIp: string | undefined, tokenReadonly?: boolean): boolean =>
  isLoopbackAddress(clientIp) ? false : (tokenReadonly ?? false);

/**
 * Remote MCP over Streamable HTTP.
 *
 * figwright's MCP interface has historically been stdio-only: the agent that connects must live on
 * the same machine as the Figma plugin. This endpoint serves the same McpServer over HTTP so an
 * agent on another machine — for example a teammate's VSCode on the LAN — can connect to *this*
 * machine's Figma plugin and read (figma-to-code) or read+write (code-to-figma) the file. A
 * connection from this same machine (loopback) is always read+write; a remote (LAN) peer is
 * governed by the matching token's effective permission, which falls back to the FIGWRIGHT_READONLY
 * flag.
 *
 * It rides the same Node HTTP server the relay and leader endpoints already use (so it shares the
 * port and the FIGWRIGHT_HOST bind), and reuses the LAN token: a network-reachable socket needs an
 * authenticated stranger to be impossible to reach, so every /mcp request must carry the shared
 * secret as `x-figwright-token` or `Authorization: Bearer <token>`.
 *
 * The SDK transport speaks Web Standard `Request`/`Response`; the bridging below converts the Node
 * `IncomingMessage`/`ServerResponse` to and from those, which lets us keep figwright's existing
 * Node http plumbing untouched.
 */

export interface McpHttpDeps {
  /** Builds a fresh McpServer — tools already filtered for read-only mode by the caller. Accepts a
   * per-connection read-only override so a token pinned read-only gets a read-only server. */
  createServer: (readonlyOverride?: boolean) => McpServer;
  /**
   * Token registry. When non-null (LAN mode or a pinned token), every /mcp request must carry a
   * valid token as `x-figwright-token` or `Authorization: Bearer <token>`. `null` on the default
   * loopback bind, where the socket isn't network-reachable and the check is a no-op.
   */
  tokens: TokenRegistry | null;
  /**
   * Host the socket is bound to. When non-loopback (LAN mode) the loopback-only Host gate relaxes
   * to admit the bound LAN interface address — passed through to isAllowedHost.
   */
  bindHost?: string;
  log?: (msg: string) => void;
  path?: string;
}

const MCP_PATH = '/mcp';

const matchToken = (req: IncomingMessage, tokens: TokenRegistry | null): TokenInfo | null => {
  if (tokens === null) return null;
  const header = req.headers['x-figwright-token'];
  if (typeof header === 'string' && tokens.has(header)) return tokens.match(header, false);
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    const bearer = auth.slice(7).trim();
    if (tokens.has(bearer)) return tokens.match(bearer, false);
  }
  return null;
};

/** Buffer the request body so we can both parse it for audit (tool name) and hand it to the Web
 * Request — a stream can only be consumed once. GET/HEAD have no body, so they return undefined. */
const readBodyBuffer = (req: IncomingMessage): Promise<Buffer | undefined> =>
  new Promise(resolve => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', () => resolve(undefined));
  });

const toWebRequest = (req: IncomingMessage, url: URL, bodyBuf?: Buffer): Request => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  // Node's Request requires `duplex: 'half'` when the body is a stream (browsers don't); without it
  // the constructor throws "duplex option is required when sending a body".
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  // GET/HEAD have no body. For other methods hand the buffered body (or the stream) to the Web Request.
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = bodyBuf
      ? Readable.from(bodyBuf) // resets cleanly per call
      : (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>);
    init.duplex = 'half';
  }
  return new Request(url, init);
};

const writeWebResponse = async (res: ServerResponse, webRes: Response): Promise<void> => {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  // enableJsonResponse keeps the body finite (plain JSON), so a single read is correct and avoids
  // awaiting inside a loop. A streaming (SSE) body would only occur with that flag off, which we don't use.
  if (webRes.body !== null) {
    const buf = Buffer.from(await webRes.arrayBuffer());
    res.end(buf);
  } else {
    res.end();
  }
};

const writeUnauthorized = (res: ServerResponse): void => {
  res.writeHead(403, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'forbidden — token required' }));
};

export const attachMcpHttp = (server: HttpServer, deps: McpHttpDeps): (() => void) => {
  const log = deps.log ?? ((): void => {});
  const path = deps.path ?? MCP_PATH;

  // Remote MCP over Streamable HTTP — stateless-tolerant mode.
  //
  // figwright is a relay: many agents (and frequent reconnects) hit /mcp, and the Figma bridge is
  // established per tool call, so there is no cross-request session state to preserve. We therefore
  // run the SDK transport WITHOUT a sessionIdGenerator. In that mode `validateSession` short-circuits
  // and the server NEVER requires an `Mcp-Session-Id` header — which tolerates clients that don't
  // forward it (several `mcp-remote` builds drop it after `initialize`, producing the confusing
  // "Server not initialized" error against a strict server). Every request gets a fresh, independent
  // transport+McpServer and we close the transport right after the (finite, JSON) response is written,
  // so there is nothing to leak. enableJsonResponse keeps the body finite (no SSE stream), which is
  // all figwright needs and the simplest thing to bridge back to Node.

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const reqUrl = req.url ?? '/';
      // Direct-delivery asset proxy: GET /asset/<token> streams the staged bytes straight to the
      // partner's HTTP client (zero base64 over MCP). Handle it here — the single response writer —
      // before the /mcp path + auth so it never races with the MCP handler for the same request.
      if (req.method === 'GET' && reqUrl.startsWith(ASSET_PATH)) {
        await serveAsset(req, res, log);
        return;
      }
      // Not our path: leave the response untouched so the relay / leader endpoints handle it.
      if (reqUrl !== path && !reqUrl.startsWith(`${path}?`)) return;

      if (!isAllowedHost(req.headers.host, deps.bindHost)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden host' }));
        return;
      }
      // Authenticate against the token registry; null registry (loopback bind) means no token needed.
      const info = matchToken(req, deps.tokens);
      if (deps.tokens !== null && info === null) {
        writeUnauthorized(res);
        return;
      }

      const clientIp = req.socket.remoteAddress ?? 'unknown';
      log(`[mcp-http] ${req.method} ${reqUrl} from ${clientIp}`);

      // Fresh, independent transport+McpServer per request. Stateless mode (sessionIdGenerator left
      // undefined) means the SDK never requires an `Mcp-Session-Id` header — which tolerates clients
      // that drop it after `initialize` (several `mcp-remote` builds do, surfacing as the misleading
      // "Server not initialized" against a strict server). Local (loopback) connections are this
      // machine's own agent and are always read-write; remote (LAN) peers stay governed by the
      // matching token's effective permission.
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      const mcp = deps.createServer(connectionReadonly(clientIp, info?.readonly));
      await mcp.connect(transport);

      // Buffer the body once so we can both audit it (extract the tool name) and forward it.
      const bodyBuf = await readBodyBuffer(req);
      let toolName: string | undefined;
      if (bodyBuf) {
        try {
          const rpc = JSON.parse(bodyBuf.toString('utf8'));
          if (rpc && rpc.method === 'tools/call' && rpc.params && typeof rpc.params.name === 'string') {
            toolName = rpc.params.name;
          }
        } catch {
          /* not JSON-RPC we recognise — still forward it */
        }
      }

      const url = new URL(reqUrl, `http://${req.headers.host ?? 'localhost'}`);
      const webReq = toWebRequest(req, url, bodyBuf);
      const startedAt = Date.now();
      const webRes = await transport.handleRequest(webReq);
      await writeWebResponse(res, webRes);
      // Stateless: nothing to reuse — free the transport now that the (finite JSON) response is written.
      void transport.close().catch(() => {});

      // Audit a real tool call (not initialize/ping): who, which tool, how long, success. The
      // dashboard parses these `[audit]` lines into a live activity feed and per-tool counters.
      if (toolName !== undefined) {
        const durMs = Date.now() - startedAt;
        const tokenLabel = info?.label ?? 'local';
        const peerType = clientIp === '127.0.0.1' || clientIp === '::1' ? 'local-agent' : 'remote-agent';
        log(
          `[audit] tool_call peer=${peerType} ip=${clientIp} token=${tokenLabel} ` +
            `tool=${toolName} ok=${webRes.ok} durMs=${durMs}`,
        );
      }
    } catch (err) {
      log(`[mcp-http] request error: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'internal error' }));
    }
  };

  server.on('request', handler);
  log(`[mcp-http] mounted on ${path} (remote MCP enabled, stateless-tolerant)`);
  return (): void => {
    server.removeListener('request', handler);
  };
};

const ASSET_PATH = '/asset/';
const ASSET_TOKEN_RE = /^[A-Za-z0-9_-]+$/;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

/**
 * Direct-delivery proxy: GET /asset/<token> streams the staged file bytes straight to the partner's
 * HTTP client, so the image never crosses the MCP channel as base64. The token is the only secret
 * (24-byte base64url, unguessable), so no MCP auth header is required — a generic `curl`/`fetch` from
 * the partner's agent can retrieve it. The byte is read via `peek` (non-consuming), allowing retries
 * within the TTL; the background sweep still reaps expired staged files.
 *
 * Called from the single MCP request handler (NOT a second `server.on('request')` listener) so there
 * is exactly one response writer — a second listener races with the MCP handler and crashes with
 * ERR_HTTP_HEADERS_SENT when both try to write the same response.
 */
export const serveAsset = async (
  req: IncomingMessage,
  res: ServerResponse,
  log: (msg: string) => void,
): Promise<void> => {
  const reqUrl = req.url ?? '';
  // split('?')[0] is `string | undefined` under noUncheckedIndexedAccess — '' then fails the token regex.
  const token = decodeURIComponent(reqUrl.slice(ASSET_PATH.length).split('?')[0] ?? '');
  if (!ASSET_TOKEN_RE.test(token)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad asset token' }));
    return;
  }
  const mgr = getTransferManager();
  if (!mgr) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'no transfer target configured' }));
    return;
  }
  let asset: { bytes: Buffer; name: string } | null = null;
  try {
    asset = await mgr.peek(token);
  } catch (err) {
    log(`[asset-proxy] peek failed: ${(err as Error).message}`);
  }
  if (!asset) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'asset not found or expired' }));
    return;
  }
  const ext = asset.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  res.writeHead(200, {
    'content-type': mime,
    'content-length': asset.bytes.length,
    'content-disposition': `attachment; filename="${asset.name}"`,
    'cache-control': 'no-store',
  });
  res.end(asset.bytes);
  log(`[asset-proxy] served ${asset.name} (${asset.bytes.length} bytes) token=${token.slice(0, 8)}…`);
};
