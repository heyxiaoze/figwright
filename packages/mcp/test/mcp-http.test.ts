import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LATEST_PROTOCOL_VERSION, McpServer } from '@modelcontextprotocol/server';

import { attachMcpHttp } from '../src/mcp-http.js';
import { buildTokenRegistry } from '../src/tokens.js';

/**
 * These exercise the Node↔Web Standard bridge plus token gating without depending on the full
 * election/relay stack. A real McpServer is driven through attachMcpHttp over a localhost socket.
 */

interface Harness {
  base: string;
  stop: () => Promise<void>;
}

const TOKEN = 'test-secret';

async function start(token: string | undefined): Promise<Harness> {
  const http: Server = createServer();
  const mcp = new McpServer({ name: 'figwright-test', version: '0.0.0' });
  // null → loopback posture (no auth); otherwise a single-entry registry from the legacy token.
  const tokens = token === undefined ? null : buildTokenRegistry({ legacyToken: token, serverReadonly: false });
  const detach = attachMcpHttp(http, {
    createServer: () => mcp,
    tokens,
    log: () => {},
  });
  // A fallback handler proves the mcp handler leaves non-/mcp paths alone (no swallowed 404s).
  http.on('request', (req, res) => {
    if (req.url === '/mcp') return;
    res.writeHead(418);
    res.end('not-mcp');
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));
  const port = (http.address() as AddressInfo).port;
  // connect() is fire-and-forget inside attachMcpHttp; give it a tick to become ready.
  await new Promise((r) => setTimeout(r, 300));
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        detach();
        http.close(() => resolve());
      }),
  };
}

async function initialize(base: string, headers: Record<string, string>): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
    }),
  });
}

describe('attachMcpHttp', () => {
  let h: Harness;

  afterEach(async () => {
    await h.stop();
  });

  it('refuses /mcp without a token when one is configured (403)', async () => {
    h = await start(TOKEN);
    const res = await initialize(h.base, {});
    expect(res.status).toBe(403);
  });

  it('accepts /mcp with x-figwright-token (stateless: no session id issued)', async () => {
    h = await start(TOKEN);
    const res = await initialize(h.base, { 'x-figwright-token': TOKEN });
    expect(res.status).toBe(200);
    // Stateless-tolerant mode (sessionIdGenerator: undefined) issues no session id — clients that
    // drop Mcp-Session-Id after initialize keep working, which is the whole point.
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });

  it('accepts Authorization: Bearer <token> (stateless: no session id issued)', async () => {
    h = await start(TOKEN);
    const res = await initialize(h.base, { authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });

  it('does not gate /mcp when no token is configured (loopback posture)', async () => {
    h = await start(undefined);
    const res = await initialize(h.base, {});
    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });

  it('leaves non-/mcp paths to other handlers (fallback answers 418)', async () => {
    h = await start(TOKEN);
    const res = await fetch(`${h.base}/ping`);
    expect(res.status).toBe(418);
  });
});
