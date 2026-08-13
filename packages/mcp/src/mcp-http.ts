import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';

import type { McpServer } from '@modelcontextprotocol/server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';

import { isAllowedHost } from './local-access.js';

/**
 * Remote MCP over Streamable HTTP.
 *
 * figwright's MCP interface has historically been stdio-only: the agent that connects must live on
 * the same machine as the Figma plugin. This endpoint serves the same McpServer over HTTP so an
 * agent on another machine — for example a teammate's VSCode on the LAN — can connect to *this*
 * machine's Figma plugin and read (figma-to-code) or read+write (code-to-figma) the file, governed
 * by the FIGWRIGHT_READONLY flag.
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
  /** Builds a fresh McpServer — tools already filtered for read-only mode by the caller. */
  createServer: () => McpServer;
  /**
   * Shared secret. When set (LAN mode or a pinned FIGWRIGHT_TOKEN), every /mcp request must carry
   * it as `x-figwright-token` or `Authorization: Bearer <token>`. Undefined on the default
   * loopback bind, where the socket isn't network-reachable and the check is a no-op.
   */
  token: string | undefined;
  /**
   * Host the socket is bound to. When non-loopback (LAN mode) the loopback-only Host gate relaxes
   * to admit the bound LAN interface address — passed through to isAllowedHost.
   */
  bindHost?: string;
  log?: (msg: string) => void;
  path?: string;
}

const MCP_PATH = '/mcp';

const tokenOk = (req: IncomingMessage, token: string | undefined): boolean => {
  if (token === undefined) return true;
  const header = req.headers['x-figwright-token'];
  if (typeof header === 'string' && header === token) return true;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() === token;
  }
  return false;
};

const toWebRequest = (req: IncomingMessage, url: URL): Request => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = req.method ?? 'GET';
  // Node's Request requires `duplex: 'half'` when the body is a stream (browsers don't); without it
  // the constructor throws "duplex option is required when sending a body".
  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  // GET/HEAD have no body. For other methods hand the IncomingMessage stream to the Web Request.
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
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

  // Streamable HTTP is stateful *per session*: the SDK assigns each connection a Mcp-Session-Id and an
  // McpServer may only be initialised once. figwright is a relay, so multiple agents (and
  // reconnects) hit this endpoint — a single shared McpServer would reject the second `initialize`
  // with "Server already initialized". So we spin up a fresh transport+McpServer per session and key
  // them by the SDK-assigned session id. enableJsonResponse keeps responses as plain JSON (no SSE
  // stream), which is all figwright needs and the simplest thing to bridge back to Node.
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

  const createSession = async (): Promise<WebStandardStreamableHTTPServerTransport> => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    const mcp = deps.createServer();
    await mcp.connect(transport);
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    log('[mcp-http] new session');
    return transport;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const reqUrl = req.url ?? '/';
      // Not our path: leave the response untouched so the relay / leader endpoints handle it.
      if (reqUrl !== path && !reqUrl.startsWith(`${path}?`)) return;

      if (!isAllowedHost(req.headers.host, deps.bindHost)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'forbidden host' }));
        return;
      }
      if (!tokenOk(req, deps.token)) {
        writeUnauthorized(res);
        return;
      }

      const clientIp = req.socket.remoteAddress ?? 'unknown';
      log(`[mcp-http] ${req.method} ${reqUrl} from ${clientIp}`);

      // Reuse the existing session if the client sent a known session id; otherwise open a fresh one
      // (a brand-new initialize, or a reconnect presenting a session we no longer have).
      const sessionId = req.headers['mcp-session-id'];
      let transport: WebStandardStreamableHTTPServerTransport | undefined;
      if (typeof sessionId === 'string' && sessions.has(sessionId)) {
        transport = sessions.get(sessionId);
      } else {
        transport = await createSession();
      }

      const url = new URL(reqUrl, `http://${req.headers.host ?? 'localhost'}`);
      const webReq = toWebRequest(req, url);
      const webRes = await transport.handleRequest(webReq);
      // The session id is assigned during initialize; remember it so later requests reuse this session.
      if (transport.sessionId && !sessions.has(transport.sessionId)) {
        sessions.set(transport.sessionId, transport);
      }
      await writeWebResponse(res, webRes);
    } catch (err) {
      log(`[mcp-http] request error: ${(err as Error).message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
      }
      res.end(JSON.stringify({ error: 'internal error' }));
    }
  };

  server.on('request', handler);
  log(`[mcp-http] mounted on ${path} (remote MCP enabled)`);
  return (): void => {
    server.removeListener('request', handler);
    for (const transport of sessions.values()) {
      void transport.close().catch(() => {});
    }
    sessions.clear();
  };
};
