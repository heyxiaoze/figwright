/**
 * Canonical English copy for the Figwright plugin UI.
 *
 * This object is the single source of truth for keys: `Messages` is derived from it, so every
 * locale must supply exactly these keys. Keep strings professional and parallel across languages —
 * the goal is a consistent product voice, not a literal translation of whatever was written first.
 *
 * Placeholders use `{name}` and are filled by `t(key, params)`.
 */

export const en = {
  // --- Tab bar ------------------------------------------------------------------------------
  'tab.activity': 'Activity',
  'tab.context': 'Context',
  'tab.debug': 'Debug',
  'tab.settings': 'Settings',

  // --- Connection status (header) -----------------------------------------------------------
  'status.idle': 'Idle',
  'status.connecting': 'Connecting',
  'status.connected': 'Connected',
  'status.reconnecting': 'Reconnecting',
  'status.disconnected': 'Disconnected',

  // --- Footer --------------------------------------------------------------------------------
  'footer.calls': '{n} calls',
  'footer.failed': '{n} failed',

  // --- Window controls -----------------------------------------------------------------------
  'bg.title':
    'Run in background — hides the panel but keeps the relay connected. Run the plugin again to bring it back.',
  'bg.label': 'Run in background',
  'grip.title': 'Drag to resize',

  // --- Copy button / payload blocks ----------------------------------------------------------
  'copy.copied': 'Copied',
  'payload.truncatedBlock': 'Showing the first part only — the full result was larger.',
  'payload.truncatedPreview': '… (truncated for display)',

  // --- Activity tab --------------------------------------------------------------------------
  'activity.connectedIdle': 'Connected and idle',
  'activity.waitingClient': 'Waiting for the MCP client',
  'activity.idleHint': 'Tool calls from your agent will show up here.',
  'activity.waitHint': 'Start your agent — this panel connects automatically.',

  // --- Activity row --------------------------------------------------------------------------
  'row.revealAria': 'Reveal the nodes {method} touched',
  'row.revealTitle': 'Select and zoom to the nodes this call touched',
  'row.started': 'Started {time}',
  'row.error': 'Error',
  'row.request': 'Request',
  'row.payloadLlm': 'Payload → LLM',

  // --- Context tab ---------------------------------------------------------------------------
  'ctx.file': 'File',
  'ctx.page': 'Page',
  'ctx.editor': 'Editor',
  'ctx.selection': 'Selection ({n})',
  'ctx.more': '…and {n} more',
  'ctx.nothingSelected': 'Nothing selected',
  'ctx.waiting': 'Waiting for plugin context…',
  'editor.dev':
    'Dev Mode blocks every write — nodes, pages, variables and styles alike. Reads, exports ' +
    '(screenshots, PDF) and plugin data still work. Switch the file to Design mode to make changes.',
  'editor.figjam':
    'FigJam has no components, variables or styles, so the tools that read or edit them fail ' +
    'there — frames, sections, shapes and text all work. Open a Figma Design file for the rest.',

  // --- Debug tab -----------------------------------------------------------------------------
  'dbg.connection': 'Connection',
  'dbg.session': 'Session',
  'dbg.resumed': ' (resumed)',
  'dbg.reconnects': 'Reconnects',
  'dbg.plugin': 'Plugin',
  'dbg.server': 'Server',
  'dbg.calls': 'Calls',
  'dbg.total': 'Total',
  'dbg.failed': 'Failed',
  'dbg.avg': 'Avg (recent)',
  'dbg.recentErrors': 'Recent errors',
  'dbg.noErrors': 'No errors.',
  'dbg.diagnostics': 'Diagnostics',
  'dbg.copyBundle': 'Copy diagnostic bundle',
  'dbg.bundleHint': 'For bug reports · includes your design content.',

  // --- Settings tab --------------------------------------------------------------------------
  'set.language': 'Language',
  'set.quickConnect': 'Quick connect (invite)',
  'set.quickConnectHint':
    'Paste the entire “invite” line from the server’s startup log to fill in Host / Port ' +
    'automatically — no manual entry needed.',
  'set.invitePlaceholder': 'figwright://connect?host=…&port=3055',
  'set.fillIn': 'Fill in',
  'set.inviteError':
    'Unrecognized invite — it should start with “figwright://connect?” and include host / port.',
  'set.connection': 'Connection',
  'set.connectionHint':
    'The plugin reaches the Figwright server at this address. The relay is loopback-only, so the ' +
    'plugin must run on the same machine as the server — the default 127.0.0.1 keeps everything ' +
    'local. Change Host / Port only if your server binds a different local address.',
  'set.host': 'Host',
  'set.hostPlaceholder': '127.0.0.1',
  'set.port': 'Port',
  'set.portError': 'Enter a port between 1 and 65535.',
  'set.connectionTarget': 'Connection target',
  'set.copy': 'Copy',
  'set.copied': '{label} copied',
  'set.copyFailed': '{label} copy failed',
  'set.saveReconnect': 'Save & reconnect',
  'set.resetLoopback': 'Reset to loopback',
  'set.diagnostics': 'Connection diagnostics',
  'set.connected': 'Connected',
  'set.connectedServer': ' (server v{v})',
  'set.currentStatus': 'Current status: {status}',
  'set.versionNotice': 'Version notice: {notice}',
  'set.testConnection': 'Test connection',
  'set.testing': 'Testing…',
  'set.testTimeout': 'Timed out: no connection within 3 seconds.',
  'set.connError':
    'Cannot connect — check that Host / IP and port are correct, the server is running, and this ' +
    'machine can reach that address.',
  'set.testHandshakeHint':
    'Performs a one-off handshake with the current Host / Port without changing your saved ' +
    'connection.',
  'set.copyTargetLabel': 'connection address',

  // --- Relay client (connection errors, generated in the iframe) ------------------------------
  'relay.noServer':
    'No Figwright server on :{ports} yet — it connects automatically once the MCP server starts; ' +
    'if it never does, another process may be holding that port.',
  'relay.socketErrorPort': 'Socket error on port {port}',
  'relay.decodeFailure': 'Decode failure: {message}',
  'relay.helloRejected': 'Hello rejected: {message}',
  'relay.socketClosed': 'Socket closed before hello on port {port}',
  'relay.socketError': 'Socket error',
  'relay.noHandler': 'No tool handler registered (method={method})',

  // --- Payload preview -----------------------------------------------------------------------
  'payload.elided': '‹{n} chars elided›',

  // --- Relative time -------------------------------------------------------------------------
  'time.now': 'now',
  'time.seconds': '{s}s',
  'time.minutes': '{m}m',
  'time.hours': '{h}h',

  // --- Fatal mount errors (developer-facing) --------------------------------------------------
  'fatal.error': 'error: {msg}',
  'fatal.rejection': 'rejection: {msg}',

  // --- Server-originated notices (version skew / protocol mismatch) ---------------------------
  'notice.protocolMismatch':
    'Protocol mismatch: server uses {server}, plugin uses {plugin}. Update the outdated Figwright ' +
    'half so both match (server: @figwright/mcp; plugin: re-import the latest release), then ' +
    'reopen this plugin in Figma.',
  'notice.skew':
    'Figwright plugin v{plugin} is older than this server (v{server}); this result is unverified ' +
    '— some edits may not have applied and reads may be incomplete. Update the plugin: download ' +
    'the latest Figwright-Plus release from {url} and re-import it in Figma (Plugins → ' +
    'Development → Import plugin from manifest).',
} as const;

/**
 * Keys are enforced (every locale must supply exactly these); values are widened to `string`
 * so other locales can carry their own wording while keeping the same `{param}` placeholders.
 */
export type Messages = { [K in keyof typeof en]: string };
