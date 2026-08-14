import { PROTOCOL_VERSION } from '@figwright/shared';
import { tryOnScopeDispose, useDocumentVisibility } from '@vueuse/core';
import { computed, type ComputedRef, onMounted, type Ref, ref, watch } from 'vue';

import type { ConnectionSettings } from '../../protocol/panel-control.js';
import { type PluginContextEvent } from '../../protocol/bridge.js';
import { RelayClient } from '../relay/client.js';
import { buildDiagnosticBundle } from '../relay/diagnostics.js';
import type { RelayClientState } from '../relay/state.js';
import { onSandboxContext } from '../sandbox/messaging.js';
import { createToolBridge } from '../sandbox/tool-bridge.js';

export interface RelaySession {
  /** Live mirror of the relay client's state. */
  state: Ref<RelayClientState>;
  /** Latest context pushed up from the sandbox, or null before the first push. */
  context: Ref<PluginContextEvent | null>;
  /** True while at least one tool call is in flight. */
  busy: ComputedRef<boolean>;
  /** This session's id; updates when the client is rebuilt after a settings change. */
  sessionId: Ref<string>;
  /** Serialized bundle (versions + context + calls) for pasting into a bug report. */
  buildDiagnostics: () => string;
}

/**
 * Owns the relay connection for the panel: the client and sandbox bridge, their lifecycle, and the
 * activity/visibility signalling that decides which open file the leader routes tool calls to.
 *
 * That routing behaviour is the reason this lives in one composable rather than being spread across
 * components — the invariants below are subtle and were arrived at empirically.
 *
 * `settings` (host/port) is reactive so a save in the Settings tab — or a settings push from
 * the sandbox — rebuilds the client against the new target. The default loopback target connects on
 * mount; only a *change* reconnects, so an identical echo from the sandbox doesn't churn the socket.
 */
export const useRelaySession = (
  appVersion: string,
  settings: Ref<ConnectionSettings>,
): RelaySession => {
  const bridge = createToolBridge({ log: msg => console.log(msg) });

  const buildClient = (s: ConnectionSettings): RelayClient => {
    const client = new RelayClient({
      // The relay leader always binds one fixed port; in LAN mode that port is whatever the user
      // configured. Scanning a range would only risk stalling on unrelated local services.
      ports: [s.port],
      clientVersion: appVersion,
      host: s.host,
      log: msg => console.log(msg),
    });
    client.setToolHandler(bridge.handler);
    return client;
  };

  let client = buildClient(settings.value);
  const state = ref<RelayClientState>(client.getState());
  const context = ref<PluginContextEvent | null>(null);
  const sessionId = ref<string>(client.sessionId);
  const visibility = useDocumentVisibility();

  let stopSubscribe = client.subscribe(s => {
    state.value = s;
  });

  // Rebuild the client against a new target. Disconnect the old socket first so two plugin sessions
  // don't briefly race for routing on the leader; the session id changes, so surface the new one.
  const rebuild = async (s: ConnectionSettings): Promise<void> => {
    const prev = client;
    stopSubscribe();
    await prev.disconnect().catch(() => {});
    client = buildClient(s);
    stopSubscribe = client.subscribe(st => {
      state.value = st;
    });
    sessionId.value = client.sessionId;
    await client.connect().catch(err => console.warn('[relay-client] reconnect failed:', err));
  };

  // Track the last target we actually connected with, so an identical settings push (e.g. the
  // sandbox echoing back the stored loopback defaults) doesn't tear down and rebuild the socket.
  let lastHost = settings.value.host;
  let lastPort = settings.value.port;
  watch(settings, s => {
    if (s.host === lastHost && s.port === lastPort) return;
    lastHost = s.host;
    lastPort = s.port;
    void rebuild(s);
  });

  // Re-assert this session's activity from the latest known context. The leader routes to the
  // most-recently-active session, so emitting bumps this plugin to the front. No-op until the sandbox
  // has pushed at least one context (file/page identity is required by ActivityParams).
  const emitActivity = (): void => {
    const c = context.value;
    if (c === null) return;
    // Only the foreground tab reports `visible`; background tabs are `hidden` (verified empirically on
    // Figma desktop). Gating activity on visibility means only the file the user is actually looking at
    // ever claims routing — so switching tabs auto-follows the foreground file, and a background tab can
    // never steal routing via a broadcast focus/visibility event. This is the core of selection/visibility
    // -driven routing. See [[project-routing-stability-backlog]].
    if (visibility.value !== 'visible') return;
    client.notifyActivity({ fileName: c.fileName, pageId: c.pageId, pageName: c.pageName });
  };

  const stopContext = onSandboxContext(event => {
    context.value = event;
    // A context push is proof the user is active here right now — a throttle-immune signal (postMessage
    // isn't clamped like background-tab timers). Nudge the relay to probe now in case a reconnect
    // stalled while backgrounded; wake() no-ops when already connected.
    client.wake();
    // Each context push from sandbox means the user just interacted (open / selection-change /
    // page-change). Tell the leader — params carry file/page identity so ping can report which
    // file is being routed instead of an opaque session id.
    emitActivity();
  });

  // When this tab becomes the foreground (visibility → 'visible'), re-assert activity so routing follows
  // the file the user switched to — even with no canvas click. `useDocumentVisibility` is backed solely by
  // the `visibilitychange` event, which only fires on the tab whose visibility actually changed. We
  // deliberately do NOT react to window `focus`: that fires on EVERY tab when the user returns to the Figma
  // app (it's not per-tab), which is exactly the broadcast that made background files steal routing.
  // emitActivity's `visible` gate keeps the background side (going → hidden) silent.
  watch(visibility, v => {
    if (v !== 'visible') return;
    // Returning to the foreground unfreezes throttled timers. Browsers throttle (and after a few minutes
    // freeze) timers in hidden tabs, so a reconnect back-off that began while the user switched away — the
    // classic "opened the plugin, then launched the MCP client" flow — can stall long past when the server
    // came up. Nudge the client to probe now so it connects immediately instead of waiting out that sleep.
    client.wake();
    emitActivity();
  });

  // Mirror the relay client's state into a ref — subscribe synchronously so the panel reflects the
  // initial state, then tear everything down when the component's reactive scope is disposed.
  tryOnScopeDispose(() => {
    stopSubscribe();
    stopContext();
    bridge.dispose();
    client.disconnect().catch(() => {});
  });

  onMounted(() => {
    client.connect().catch(err => console.warn('[relay-client] initial connect failed:', err));
  });

  return {
    state,
    context,
    // Derived here rather than in the panel: "the agent is working" is a fact about the session, and
    // more than one piece of chrome reads it.
    busy: computed(() => state.value.activity.some(e => e.status === 'pending')),
    sessionId,
    buildDiagnostics: () =>
      buildDiagnosticBundle(state.value, context.value, {
        pluginVersion: appVersion,
        protocolVersion: PROTOCOL_VERSION,
        sessionId: client.sessionId,
        userAgent: navigator.userAgent,
      }),
  };
};
