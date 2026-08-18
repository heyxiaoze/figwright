/**
 * Per-call file/session selector.
 *
 * When the Figma plugin is open in several files at once, each file is a separate plugin session
 * (see `Relay`/`SessionManager`). By default a tool call routes to the most-recently-active one —
 * the file the user last interacted with in Figma. That is right for an agent driving one file, but
 * it gives no way to address a *specific* open file. This module defines the optional `sessionId`
 * argument every tool accepts, plus the pure helpers that pull it out of a call's arguments and
 * strip it before the call reaches the plugin (which knows nothing about sessions).
 *
 * The routing itself lives in `relay.sendRequest`'s existing session-pinning path; this is just the
 * peer-facing surface and the argument surgery around it.
 */

export const SESSION_ID_FIELD = 'sessionId';

export const SESSION_ID_DESCRIPTION =
  'Optional. Target a specific connected Figma file (plugin session) by its id. Discover the ids ' +
  'and their file/page labels from the `ping` tool (sessions.all[]). When omitted, the call routes ' +
  'to the most-recently-active file — the one you last interacted with in Figma. Use this to address ' +
  'a specific file when the plugin is open in several Figma files at once. Ignored by server-local ' +
  'tools (ping, fetch_asset, analyze_project, …) that do not target a file.';

/** Read the requested session id from a tool call's arguments, or undefined when none was given. */
export const extractSessionId = (args: unknown): string | undefined => {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    const value = (args as Record<string, unknown>)[SESSION_ID_FIELD];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
};

/**
 * Return a shallow copy of `args` with the selector field removed, so it is never forwarded to the
 * plugin (which would reject the unknown key and, more importantly, should not be told about
 * server-side routing). No-op when the field is absent.
 */
export const stripSessionId = (args: unknown): unknown => {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    if (SESSION_ID_FIELD in record) {
      const { [SESSION_ID_FIELD]: _omit, ...rest } = record;
      return rest;
    }
  }
  return args;
};
