import { execSync } from 'node:child_process';

import { buildTokenRegistry, generateToken, type TokenRegistry } from './tokens.js';
import { DEFAULT_PORT, type GetScreenshotResult, newId, PROTOCOL_VERSION } from '@figwright/shared';
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { localInterfaceHosts } from './local-access.js';

import pkg from '../package.json' with { type: 'json' };
import { BUILD_ID } from './build-id.js';
import { dispatchTool, resolveRoutingSession } from './dispatch.js';
import { z } from 'zod';
import { Election } from './election/election.js';
import { Follower } from './election/follower.js';
import { attachLeaderEndpoints } from './election/leader-endpoints.js';
import { attachMcpHttp } from './mcp-http.js';
import { Node, NodeRole } from './election/node.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { wireShutdown } from './lifecycle.js';
import { normalizeIdArgs } from './node-id.js';
import { PROMPTS } from './prompts/registry.js';
import { ANALYZE_PROJECT_TOOL_NAME, handleAnalyzeProject } from './tools/analyze-project.js';
import { annotationsFor } from './tools/annotations.js';
import { COMPONENT_MAP_TOOL_NAME, handleComponentMap } from './tools/component-map.js';
import { handleDesignContext } from './tools/design-context-guard.js';
import { DESIGN_DIFF_TOOL_NAME, handleDesignDiff } from './tools/design-diff.js';
import { EXPORT_PDF_TOOL_NAME, handleExportPdf } from './tools/export-pdf.js';
import { EXPORT_VIDEO_TOOL_NAME, handleExportVideo } from './tools/export-video.js';
import { GET_DESIGN_CONTEXT_TOOL_NAME } from './tools/get-design-context.js';
import { GET_SCREENSHOT_TOOL_NAME, screenshotContent } from './tools/get-screenshot.js';
import { handleIconMap, ICON_MAP_TOOL_NAME } from './tools/icon-map.js';
import { formatPingResult, handlePing, pingTool } from './tools/ping.js';
import { ALL_TOOL_SPECS, filterToolSpecs, WRITE_TOOL_NAMES } from './tools/registry.js';
import { handleSaveImageFills, SAVE_IMAGE_FILLS_TOOL_NAME } from './tools/save-image-fills.js';
import { handleSaveScreenshots, SAVE_SCREENSHOTS_TOOL_NAME } from './tools/save-screenshots.js';
import { FETCH_ASSET_TOOL_NAME, assetContent } from './tools/fetch-asset.js';
import { getTransferManager, initTransferManager } from './transfer.js';
import { handleScanComponents, SCAN_COMPONENTS_TOOL_NAME } from './tools/scan-components.js';
import {
  extractSessionId,
  SESSION_ID_DESCRIPTION,
  SESSION_ID_FIELD,
  stripSessionId,
} from './tools/session-selector.js';
import { captureSkew, withSkewNotice } from './tools/skew-notice.js';
import { handleTokenMap, TOKEN_MAP_TOOL_NAME } from './tools/token-map.js';

const SERVER_NAME = 'figwright';

// The plugin and server are one product built from the same tree, so they must report the same
// version string. The plugin bakes `1.0-<short-sha>` at build time (see
// packages/plugin/vite.config.ts) and the dashboard badge shows `v1.0-<short-sha>` (see
// scripts/dashboard.mjs); the server resolves the same string here, at startup, so a plugin and
// server cut from the same commit report identical versions and the panel's "server v…" line matches
// the plugin's own footer. Format: `<MAJOR>.<MINOR>-<short-sha>`. MAJOR bumped to 1 at the 1.0
// release (the user will say when to bump again); MINOR (`0`) increments by 1 on every release — bump
// it here in lockstep with vite.config.ts and dashboard.mjs. The string is display-only now
// (checkPluginCompatibility always returns true), so it no longer has to satisfy the semver
// comparator in packages/shared/src/version.ts.
const APP_VERSION_MAJOR = 1;
const APP_VERSION_MINOR = '7'; // bump +1 on each release — mirrors vite.config.ts / dashboard.mjs

function resolveServerVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{4,}$/.test(sha)) return `${APP_VERSION_MAJOR}.${APP_VERSION_MINOR}-${sha}`;
  } catch {
    // Not in a git checkout (e.g. a packaged install) — fall back to the published semver.
  }
  return pkg.version;
}

const SERVER_VERSION = resolveServerVersion();

const log = (msg: string): void => {
  process.stderr.write(`${msg}\n`);
};

// FIGWRIGHT_PORT is a test/debug seam (the process-lifecycle e2e spawns real servers on a random
// port). The plugin always connects to DEFAULT_PORT, so overriding this in normal use just makes
// the server unreachable — hence undocumented.
const envPort = Number(process.env.FIGWRIGHT_PORT);
const PORT = Number.isInteger(envPort) && envPort > 0 && envPort < 65_536 ? envPort : DEFAULT_PORT;

// FIGWRIGHT_HOST controls which network interface the relay binds. Default 127.0.0.1 preserves the
// loopback-only security boundary (see local-access.ts). A non-loopback host — `0.0.0.0` or a
// specific LAN address — lets the Figma plugin on another machine connect. That removes the
// loopback boundary, so FIGWRIGHT_TOKEN becomes mandatory; if the operator didn't pin one we
// generate a random secret rather than expose an unauthenticated relay on the network.
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const HOST = process.env.FIGWRIGHT_HOST ?? '127.0.0.1';
const LAN_MODE = !LOOPBACK_HOSTS.has(HOST);

// FIGWRIGHT_READONLY (optional) drops every `kind: 'write'` tool from what the server advertises,
// so a connected agent can read the Figma file (figma-to-code) but cannot modify it (code-to-figma).
// Orthogonal to LAN mode: it works over stdio too. Pair it with a pinned FIGWRIGHT_TOKEN when the
// relay is on the network so the read-only agent still authenticates.
const READONLY = /^1|true|yes|on$/i.test(process.env.FIGWRIGHT_READONLY ?? '');

// The LAN boundary is now multi-token: the operator can issue several named tokens (each optionally
// pinned read-only) and any peer presenting one is admitted. `requireAuth` is the LAN flag — when the
// relay is loopback-only no token is required, so `tokens` is passed as null and the handlers treat it
// as "open". In LAN mode we build the registry from FIGWRIGHT_TOKEN (legacy) and/or FIGWRIGHT_TOKENS
// (JSON array); if neither is set we auto-generate a random token so a freshly-started server on the
// network is never unauthenticated.
let tokens: TokenRegistry | null = null;
let autoToken: string | undefined;
if (LAN_MODE) {
  const legacy = process.env.FIGWRIGHT_TOKEN;
  const tokensJson = process.env.FIGWRIGHT_TOKENS;
  if ((legacy === undefined || legacy === '') && tokensJson === undefined) {
    autoToken = generateToken();
    log(
      `[figwright] LAN mode (host ${HOST}) — auto-generated token: ${autoToken} ` +
        `(set FIGWRIGHT_TOKEN / FIGWRIGHT_TOKENS to pin it across restarts)`,
    );
  }
  tokens = buildTokenRegistry({
    // exactOptionalPropertyTypes: only set optional keys when actually present ('' counts as unset).
    ...(legacy !== undefined && legacy !== '' ? { legacyToken: legacy } : {}),
    ...(tokensJson !== undefined ? { tokensJson } : {}),
    ...(autoToken !== undefined ? { autoToken } : {}),
    serverReadonly: READONLY,
  });
  log(`[figwright] LAN mode (host ${HOST}) — ${tokens.list().length} token(s) accepted`);
} else if (process.env.FIGWRIGHT_TOKEN !== undefined || process.env.FIGWRIGHT_TOKENS !== undefined) {
  // Loopback bind but a token was explicitly supplied — honour it (harmless, and lets a local agent
  // authenticate the same way a remote one would).
  const legacy2 = process.env.FIGWRIGHT_TOKEN;
  const tokensJson2 = process.env.FIGWRIGHT_TOKENS;
  tokens = buildTokenRegistry({
    ...(legacy2 !== undefined && legacy2 !== '' ? { legacyToken: legacy2 } : {}),
    ...(tokensJson2 !== undefined ? { tokensJson: tokensJson2 } : {}),
    serverReadonly: READONLY,
  });
}

// Resource transfer (WebDAV/SFTP staging) for remote partners. No-op / null unless FIGWRIGHT_TRANSFER
// is set — in inline mode the save tools fall back to returning base64 directly.
initTransferManager(process.env.FIGWRIGHT_TRANSFER);

// Surface the transfer posture at startup so the operator can see, at a glance, whether save_*
// results return inline base64 (local/loopback) or asset tokens (remote partner over WebDAV/SFTP).
// This closes a confusing repeat-bug where the config file still said mode:'inline' while the
// operator believed SFTP was active — base64 then kept leaking into save results. A glance at the
// startup banner now settles it immediately.
{
  const raw = process.env.FIGWRIGHT_TRANSFER;
  if (!raw) {
    log('[figwright] resource transfer: INLINE — save_* results include base64 (local/loopback mode)');
  } else {
    let mode = 'unknown';
    try {
      mode = (JSON.parse(raw) as { mode?: string }).mode ?? 'inline';
    } catch {
      mode = 'UNPARSEABLE';
    }
    if (getTransferManager()) {
      log(
        `[figwright] resource transfer: ${mode.toUpperCase()} — save_* results return asset tokens, ` +
          `base64 OMITTED (remote-partner mode)`,
      );
    } else {
      log(
        `[figwright] resource transfer: ${mode.toUpperCase()} configured but store unavailable ` +
          `(incomplete credentials?) — FALLING BACK to inline base64`,
      );
    }
  }
}

// The display token for connection guides (plugin invite / mcp-remote command) and for the follower's
// own /rpc auth to the leader. null in loopback mode where no token is expected.
const primaryToken = tokens?.primary()?.value;

const node = new Node({ serverVersion: SERVER_VERSION, port: PORT, host: HOST, log });
const follower = new Follower({ leaderUrl: node.leaderUrl, token: primaryToken, log });
const election = new Election({ node, follower, buildId: BUILD_ID, log });

let currentDetach: (() => void) | null = null;
node.onRoleChange(role => {
  if (currentDetach !== null) {
    currentDetach();
    currentDetach = null;
  }
  if (role === NodeRole.Leader) {
    const res = node.getLeader();
    if (res !== null) {
      // Leader endpoints mount first so their request handler runs first; it short-circuits /mcp
      // and lets the remote MCP handler below answer those requests without a 404.
      const detachLeader = attachLeaderEndpoints(res.http, {
        relay: res.relay,
        serverVersion: SERVER_VERSION,
        buildId: BUILD_ID,
        // In LAN mode the socket is network-reachable; relax the Host gate to the bound interface
        // and arm token auth on the mutating POST endpoints (the follower carries the same token).
        bindHost: HOST,
        tokens,
        // Newest build wins: a follower on a newer build asks us to step down; the port frees for
        // it within ms and the plugin reconnects to the new leader on its next retry (~250ms).
        onAbdicate: () => election.yieldLeadership(),
        log,
      });
      const detachMcp = attachMcpHttp(res.http, {
        createServer: createMcpServer,
        tokens,
        bindHost: HOST,
        log,
      });
      currentDetach = (): void => {
        detachMcp();
        detachLeader();
      };
    }
  }
});

type ToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

/** A dispatcher that routes a tool call, optionally pinned to a specific plugin session. */
type Dispatcher = (tool: string, args: unknown) => Promise<unknown>;

/**
 * Build a dispatcher pinned to `sessionId` (when given) or the implicit most-recently-active
 * session (when undefined). The selector field is stripped from the arguments before they reach
 * the relay — and therefore the plugin — which never learns about server-side routing.
 */
const makeDispatch = (sessionId?: string): Dispatcher => {
  const opts = sessionId !== undefined ? { sessionId } : {};
  return (tool, args) => dispatchTool({ node, follower, log }, tool, stripSessionId(args), opts);
};

// A session-pinned dispatcher for multi-call tools: resolve the active plugin once (or honor an
// explicit `sessionId` from the call), then route every sub-call to that exact session so they
// can't drift across plugins if routing flips mid-flight. Resolving to undefined (no plugin
// connected, and no explicit id) falls back to live per-call routing.
const routedDispatch = async (requestedSessionId?: string): Promise<Dispatcher> => {
  const pinned = requestedSessionId ?? (await resolveRoutingSession({ node, follower, log }));
  return makeDispatch(pinned);
};

const textResult = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
});

// Tools whose result isn't just JSON.stringify(dispatch(...)): ping reports election state, the
// server-local tools read the filesystem (some reusing dispatch), and get_screenshot returns an
// image content block. Everything else takes the generic dispatch path below. The `dispatch`
// parameter each receives is the per-call session-aware dispatcher, so an explicit `sessionId`
// from the tool call routes every internal sub-dispatch to the targeted file.
const buildSpecialHandlers = (
  sessionDispatch: Dispatcher,
  requestedSessionId: string | undefined,
): Record<string, ToolHandler> => ({
  [pingTool.name]: async () => ({
    content: [
      {
        type: 'text',
        text: formatPingResult(
          await handlePing({
            node,
            follower,
            serverVersion: SERVER_VERSION,
            buildId: BUILD_ID,
            bindHost: HOST,
            token: primaryToken,
            log,
          }),
        ),
      },
    ],
  }),
  [SAVE_SCREENSHOTS_TOOL_NAME]: async args =>
    textResult(await handleSaveScreenshots(sessionDispatch, args)),
  [SAVE_IMAGE_FILLS_TOOL_NAME]: async args =>
    textResult(await handleSaveImageFills(sessionDispatch, args)),
  [EXPORT_PDF_TOOL_NAME]: async args => textResult(await handleExportPdf(sessionDispatch, args)),
  [EXPORT_VIDEO_TOOL_NAME]: async args => textResult(await handleExportVideo(sessionDispatch, args)),
  // forVision marks this as the path whose rasters are inlined into the model's context, so the
  // sandbox caps an oversized scale to what a vision model can actually resolve. save_screenshots
  // dispatches the same tool without it — those bytes go to disk and keep the caller's scale.
  [GET_SCREENSHOT_TOOL_NAME]: async args => ({
    content: screenshotContent(
      (await sessionDispatch(GET_SCREENSHOT_TOOL_NAME, {
        ...args,
        forVision: true,
      })) as GetScreenshotResult,
    ),
  }),
  [ANALYZE_PROJECT_TOOL_NAME]: async args => textResult(await handleAnalyzeProject(args)),
  [SCAN_COMPONENTS_TOOL_NAME]: async args => textResult(await handleScanComponents(args)),
  [COMPONENT_MAP_TOOL_NAME]: async args =>
    textResult(await handleComponentMap(await routedDispatch(requestedSessionId), args)),
  [TOKEN_MAP_TOOL_NAME]: async args => textResult(await handleTokenMap(sessionDispatch, args)),
  [ICON_MAP_TOOL_NAME]: async args =>
    textResult(await handleIconMap(await routedDispatch(requestedSessionId), args)),
  [DESIGN_DIFF_TOOL_NAME]: async args => textResult(await handleDesignDiff(sessionDispatch, args)),
  // Remote partners redeem a one-time asset token here: the server pulls the staged file from its
  // WebDAV/SFTP store (credentials never leave the server), returns the bytes, and deletes the copy.
  [FETCH_ASSET_TOOL_NAME]: async args => {
    const mgr = getTransferManager();
    if (!mgr) return textResult({ ok: false, error: 'resource transfer not configured on server' });
    const token = typeof args.token === 'string' ? args.token : '';
    if (!token) return textResult({ ok: false, error: 'missing token' });
    const res = await mgr.fetch(token);
    if (!res)
      return textResult({ ok: false, error: 'asset not found or expired (token already used or timed out)' });
    return { content: assetContent(res.name, res.bytes) };
  },
  // The guarded public path: arms the plugin's node-count bail (budget: true) and applies the
  // payload-size net + below-full note. Internal dispatches (design_diff, component/icon map) call
  // the tool directly and stay raw.
  [GET_DESIGN_CONTEXT_TOOL_NAME]: async args =>
    textResult(await handleDesignContext(sessionDispatch, args)),
});

// serveStdio owns the era decision for the connection: it reads the opening exchange, pins ONE
// instance from this factory for the connection's lifetime, and passes everything after straight
// through. A 2025-era client is served exactly as `new StdioServerTransport()` + `connect()` served
// it; a 2026-07-28 client negotiates the modern revision instead — which a hand-wired transport
// can't do. On stdio there is exactly one connection per process, so this runs once.
// Builds a fresh McpServer. `readonlyOverride` lets a per-token permission win over the server-wide
// flag: a remote agent that authenticated with a read-only token gets a read-only server even when
// the relay as a whole is read-write. `undefined` (or a non-boolean, e.g. the `{ era }` object
// serveStdio passes the factory) → server-wide FIGWRIGHT_READONLY.
const createMcpServer = (readonlyOverride?: boolean): McpServer => {
  const readonly = typeof readonlyOverride === 'boolean' ? readonlyOverride : READONLY;
  const mcp = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  for (const spec of filterToolSpecs(ALL_TOOL_SPECS, { readonly })) {
    const handler: ToolHandler = async rawArgs => {
      // A peer may pin the call to a specific connected Figma file (session) instead of the
      // implicit most-recently-active one. The selector is extracted here and bound into the
      // dispatcher so every internal sub-dispatch (save_*, design_diff, …) targets the same file.
      const sessionId = extractSessionId(rawArgs);
      const sessionDispatch = makeDispatch(sessionId);
      const special = buildSpecialHandlers(sessionDispatch, sessionId);
      const run: ToolHandler =
        special[spec.name] ??
        (async args => {
          // Inject a stable idempotency key for writes before the (possibly retrying) dispatch.
          const dispatchArgs = spec.kind === 'write' ? { ...args, requestId: newId() } : args;
          return textResult(await sessionDispatch(spec.name, dispatchArgs));
        });
      // Normalize id args (a pasted Figma URL or dash-form node id → canonical colon id) once here,
      // so every tool — generic or special-cased — accepts them without per-handler conversion.
      // An older plugin drops arguments it predates and still answers `{ ok: true }`, so the result
      // cannot be trusted on its face and nothing in it says so. Saying it here, on every affected
      // call, is what replaces the refusal this used to be: the agent is told before it reports
      // success to the user.
      return captureSkew(
        () => run(normalizeIdArgs(rawArgs)),
        (result, notice) => withSkewNotice(result, notice),
      );
    };
    // The spec's own Zod object, extended with the optional session selector, goes through: it is
    // already the Standard Schema object the SDK wants. Registering heterogeneous specs through one
    // loop needed a handler cast under v1; v2's typing accepts ToolHandler directly, so the result
    // stays checked against CallToolResult.
    mcp.registerTool(
      spec.name,
      {
        description: spec.description,
        inputSchema: spec.inputSchema.extend({
          [SESSION_ID_FIELD]: z.string().optional().describe(SESSION_ID_DESCRIPTION),
        }),
        annotations: annotationsFor(spec),
      },
      handler,
    );
  }

  for (const prompt of PROMPTS) {
    mcp.registerPrompt(
      prompt.definition.name,
      {
        description: prompt.definition.description ?? '',
        argsSchema: prompt.argsSchema,
      },
      args => prompt.build(args),
    );
  }

  return mcp;
};

// Start the election only after every const the role-change handler may touch is initialized — the
// handler now builds a remote-MCP server via createMcpServer, declared just above. Starting earlier
// would hit a temporal-dead-zone ReferenceError, because consts below are not hoisted.
await election.start();

/**
 * A stdio transport that reports its own death.
 *
 * The SDK closes this transport when a read fails fatally — reachably today when an inbound message
 * exceeds the 10MB read buffer, which `import_image`'s base64 `data` can do. Closing only detaches
 * the stdin listeners and pauses the stream: it emits neither 'end' nor 'close', so none of
 * wireShutdown's triggers fire. The process then survives as a leader that can no longer hear its
 * client while still holding the relay port — a follower behind it can never take over, and nothing
 * is logged. Reporting the close routes that silent dead end into the ordinary shutdown path, after
 * which the port frees and a follower is promoted on its next tick.
 *
 * Overriding close() rather than onclose is deliberate: whoever owns the connection assigns onclose
 * for its own bookkeeping, so it is not ours to take.
 */
class SelfReportingStdioTransport extends StdioServerTransport {
  constructor(private readonly onClosed: () => void) {
    super();
  }

  override async close(): Promise<void> {
    await super.close();
    this.onClosed();
  }
}

// Deferred because the trigger only exists once wireShutdown has run, and that needs the transport.
let triggerShutdown = (): void => {};
// stdio is inherently a same-machine connection (the MCP client spawned this process locally, or
// connected over a local pipe) — it is the user's own agent, so it is always read-write regardless
// of the dashboard's read-only setting. Remote (LAN) peers reach us solely through /mcp, where their
// token's effective permission governs (see mcp-http.ts).
const stdio = serveStdio(() => createMcpServer(false), {
  // serveStdio would otherwise construct its own transport, and we need one that reports its death.
  transport: new SelfReportingStdioTransport(() => {
    triggerShutdown();
  }),
  // Unset, serveStdio discards transport errors outright, so the one message naming the cause
  // (e.g. "ReadBuffer exceeded maximum size of 10485760 bytes") never reaches the user's stderr.
  onerror: (error: Error): void => {
    log(`[figwright] stdio transport error: ${error.message}`);
  },
});

const roleDetail = node.isLeader()
  ? `relay on :${node.getLeader()?.port ?? PORT}`
  : node.isConflicted()
    ? `:${PORT} held by a non-Figwright process — contending for it`
    : `follower → ${node.leaderUrl}`;
log(
  `[figwright] server ${SERVER_VERSION} (protocol ${PROTOCOL_VERSION}) ready as ${node.role}, ${roleDetail}`,
);

// Spell out the permission posture so the operator can see, at a glance, what a connected agent may
// do. Read-only mode keeps reads + server-local codegen helpers and hides every document mutation —
// but ONLY for remote (LAN) peers. Local (loopback) connections, including this process's own stdio
// client and any agent connecting to /mcp from 127.0.0.1, are always read-write.
if (READONLY) {
  log(
    `[figwright] read-only mode — ${WRITE_TOOL_NAMES.size} write tools hidden for REMOTE (LAN) agents; ` +
      `local (loopback) connections are always read-write. Remote agents can read the Figma file ` +
      `(figma-to-code) but cannot modify it (code-to-figma).`,
  );
}

// Topology reminder printed at startup. The plugin runs on THIS machine (Figma on the user's Mac)
// and reaches the relay over the loopback address — the local plugin needs no token. Every other
// machine connects to /mcp (HTTP, token-gated) instead. So the banner advertises two distinct
// targets: the loopback relay for the local plugin (token-free), and the HTTP /mcp endpoint for
// remote partners (token required). Printed regardless of bind mode so the operator always sees the
// correct local plugin target; the partner lines appear only in LAN mode with a token.
const pluginInviteHost = '127.0.0.1';
log(`[figwright] plugin → ws://${pluginInviteHost}:${PORT}  (local, no token)`);
log(`[figwright] invite: figwright://connect?host=${pluginInviteHost}&port=${PORT}`);
if (LAN_MODE && primaryToken !== undefined) {
  const hosts = HOST === '0.0.0.0' || HOST === '::' ? [...localInterfaceHosts()] : [HOST];
  if (hosts.length === 0) {
    log(`[figwright] LAN mode: could not enumerate a LAN interface — partners connect via ${HOST}`);
  }
  for (const h of hosts) {
    log(`[figwright] partner → http://${h}:${PORT}/mcp  (token: ${primaryToken})`);
  }
}

const shutdown = async (): Promise<void> => {
  // serveStdio owns the transport it started, so it has to be the one to close it — closing the
  // pinned instance and detaching from stdin. Its own errors must not skip the relay teardown
  // below: the relay port is the resource a zombie would hold, and stdio is already going away.
  await stdio.close().catch(() => {});
  election.stop();
  await node.stop();
  process.exit(0);
};
// Exit on SIGINT/SIGTERM, on stdin EOF, and on the transport dying under us. stdin closes when the
// client that spawned us goes away (including a crash that sends no signal); without this the
// process would linger holding the relay port as a stale "zombie" leader serving an old build.
// wireShutdown runs shutdown at most once, so the transport trigger is safe to fire during our own
// shutdown — which closes that same transport. hardExit is the backstop for the graceful path
// itself stalling (e.g. a close waiting on connections that never drain) — exit code 1 marks the
// forced, non-clean variant.
triggerShutdown = wireShutdown({
  proc: process,
  stdin: process.stdin,
  shutdown,
  hardExit: () => {
    log('[figwright] graceful shutdown stalled — forcing exit');
    process.exit(1);
  },
});
