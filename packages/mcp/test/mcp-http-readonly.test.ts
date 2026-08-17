import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LATEST_PROTOCOL_VERSION, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';

import { attachMcpHttp, connectionReadonly } from '../src/mcp-http.js';
import { buildTokenRegistry } from '../src/tokens.js';

/**
 * Exercises the loopback/remote split introduced for Figwright-Plus: a connection from this same
 * machine (loopback) is always read-write, while a remote (LAN) peer is governed by the matching
 * token's effective permission. We drive a real McpServer through attachMcpHttp and inspect which
 * tools it advertises — a `write_marker` tool is registered only when the connection is read-write,
 * so its presence/absence reveals the mode.
 */

const TOKEN = 'test-secret';

interface Harness {
  port: number;
  stop: () => Promise<void>;
}

// Build a server that registers `write_marker` ONLY in read-write mode, plus an always-present
// `read_marker`. The factory's argument is the read-only override attachMcpHttp computes per session.
const makeServer = (readonly?: boolean): McpServer => {
  const s = new McpServer({ name: 'figwright-test', version: '0.0.0' });
  if (!readonly) {
    s.registerTool(
      'write_marker',
      { description: 'write-only', inputSchema: z.object({}) },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );
  }
  s.registerTool(
    'read_marker',
    { description: 'read-only', inputSchema: z.object({}) },
    async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  );
  return s;
};

const start = async (): Promise<Harness> => {
  const http: Server = createServer();
  // serverReadonly: true makes the token (which has no explicit override) resolve to read-only, so a
  // remote peer defaults to read-only — exactly the dashboard-posture we want to confirm.
  const tokens = buildTokenRegistry({ legacyToken: TOKEN, serverReadonly: true });
  const detach = attachMcpHttp(http, {
    createServer: makeServer,
    tokens,
    // Mirror LAN mode: a non-loopback bind host widens the Host gate so a peer addressing us by our
    // LAN IP is admitted (loopback-only bind would refuse it, which is what tripped this test first).
    bindHost: '0.0.0.0',
    log: () => {},
  });
  http.on('request', (req, res) => {
    if (req.url === '/mcp') return;
    res.writeHead(418);
    res.end('not-mcp');
  });
  // Bind to all interfaces so the same server is reachable both via 127.0.0.1 (loopback) and via a
  // real LAN IP (remote) from this machine — that is what lets one test cover both branches.
  await new Promise<void>((resolve) => http.listen(0, '0.0.0.0', () => resolve()));
  const port = (http.address() as AddressInfo).port;
  await new Promise((r) => setTimeout(r, 300));
  return {
    port,
    stop: () =>
      new Promise<void>((resolve) => {
        detach();
        http.close(() => resolve());
      }),
  };
};

const listTools = async (base: string, token: string): Promise<string[]> => {
  const headers = (sid?: string): Record<string, string> => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'x-figwright-token': token,
    ...(sid ? { 'mcp-session-id': sid } : {}),
  });
  const initRes = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: headers(),
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
  expect(initRes.status).toBe(200);
  // Stateless-tolerant mode (sessionIdGenerator: undefined) issues no session id — subsequent
  // requests must succeed WITHOUT the Mcp-Session-Id header (that tolerance is the feature).
  await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
  });
  const listRes = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const json = (await listRes.json()) as { result?: { tools?: Array<{ name: string }> } };
  return (json.result?.tools ?? []).map((t) => t.name);
};

describe('mcp-http read/write split (loopback vs remote)', () => {
  let h: Harness;

  afterEach(async () => {
    await h.stop();
  });

  it('exposes write tools to a loopback (127.0.0.1) connection even when read-only is set', async () => {
    h = await start();
    const tools = await listTools(`http://127.0.0.1:${h.port}`, TOKEN);
    expect(tools).toContain('read_marker');
    expect(tools).toContain('write_marker');
  });
});

describe('connectionReadonly (loopback/remote decision)', () => {
  it('forces read-write for any loopback address, ignoring the token permission', () => {
    expect(connectionReadonly('127.0.0.1', true)).toBe(false);
    expect(connectionReadonly('::1', true)).toBe(false);
    expect(connectionReadonly('::ffff:127.0.0.1', false)).toBe(false);
    expect(connectionReadonly('localhost', true)).toBe(false);
  });

  it('defers to the token permission for a remote (LAN) address', () => {
    expect(connectionReadonly('192.168.23.135', true)).toBe(true);
    expect(connectionReadonly('10.0.0.5', true)).toBe(true);
    expect(connectionReadonly('192.168.23.135', false)).toBe(false);
  });

  it('treats an absent token override on a remote address as read-only', () => {
    // The caller resolves `undefined` against the server-wide read-only flag; in LAN mode every peer
    // authenticates so this is the case where the token carried no explicit override.
    expect(connectionReadonly('192.168.1.10', undefined)).toBe(false);
  });
});
