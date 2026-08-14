/**
 * Everything the sandbox knows about the plugin _window_: opening it, remembering the size the user
 * dragged it to, and carrying out the control messages the panel sends up (see
 * `protocol/panel-control.ts`).
 *
 * It lives apart from `code.ts` so window management is one thing in one place — `code.ts` is left
 * as wiring — and so it can be tested: the panel's resize, hide and reveal paths had no coverage
 * while they were inline message-shape checks.
 */

import { isEmbeddedInPanel } from '../protocol/editor-context.js';
import {
  clampPanelSize,
  DEFAULT_CONNECTION_SETTINGS,
  type ConnectionSettings,
  createPanelSettings,
  PANEL_DEFAULT_SIZE,
  type PanelControlMessage,
  type PanelSize,
} from '../protocol/panel-control.js';
import { revealNodes } from './reveal.js';

/** `clientStorage` key holding the last size the user dragged the window to. */
export const STORED_SIZE_KEY = 'ui-size';

/** `clientStorage` key holding the connection settings (host/port) for the local relay. */
export const STORED_SETTINGS_KEY = 'connection-settings';

export interface PanelController {
  /** Show the panel at the default size, then snap to the stored one once it loads. */
  open: (html: string) => void;
  /** Carry out one control message from the UI. */
  apply: (message: PanelControlMessage) => void;
}

export const createPanelController = (figmaCtx: typeof figma): PanelController => {
  const resizeTo = (size: PanelSize): void => figmaCtx.ui.resize(size.width, size.height);

  /**
   * `clientStorage` is async, so the window necessarily opens at the default and then snaps. Clamp
   * on the way out too: a value stored before the current floor existed would otherwise reopen the
   * window at a size the layout can no longer fill.
   */
  const restoreStoredSize = async (): Promise<void> => {
    try {
      const saved: unknown = await figmaCtx.clientStorage.getAsync(STORED_SIZE_KEY);
      if (typeof saved !== 'object' || saved === null) return;
      const { width, height } = saved as { width?: unknown; height?: unknown };
      if (typeof width === 'number' && typeof height === 'number') {
        resizeTo(clampPanelSize(width, height));
      }
    } catch {
      // No saved size, or storage unavailable — the default the window already opened at stands.
    }
  };

  const reveal = async (nodeIds: readonly string[]): Promise<void> => {
    const { revealed } = await revealNodes(figmaCtx, nodeIds);
    // Only speak up on a miss: a successful reveal shows itself through the selection, so a toast
    // on top of that is just noise. Silence on a miss, though, would read as a broken button — the
    // usual cause is the call being undone, or the agent deleting what it made.
    if (revealed === 0) figmaCtx.notify('Figwright: those nodes are no longer in this file');
  };

  const readStoredSettings = async (): Promise<ConnectionSettings> => {
    try {
      const saved: unknown = await figmaCtx.clientStorage.getAsync(STORED_SETTINGS_KEY);
      if (typeof saved !== 'object' || saved === null) return DEFAULT_CONNECTION_SETTINGS;
      const { host, port } = saved as {
        host?: unknown;
        port?: unknown;
      };
      if (typeof host !== 'string' || typeof port !== 'number') {
        return DEFAULT_CONNECTION_SETTINGS;
      }
      return { host, port };
    } catch {
      return DEFAULT_CONNECTION_SETTINGS;
    }
  };

  // Push settings down to the iframe — the UI has no direct access to figma.clientStorage, so this
  // is how it learns the configured connection target (both on open and in reply to a request).
  const postStoredSettings = async (): Promise<void> => {
    const settings = await readStoredSettings();
    // figma.ui.postMessage is the Figma plugin API — there is no targetOrigin parameter
    // eslint-disable-next-line unicorn/require-post-message-target-origin
    figmaCtx.ui.postMessage(createPanelSettings(settings));
  };

  return {
    open: html => {
      figmaCtx.showUI(html, { ...PANEL_DEFAULT_SIZE, themeColors: true });
      // The UI needs its stored connection settings before it can build the relay client; post
      // them immediately (Figma buffers until the iframe script runs). The UI also sends a
      // panel-settings-request on mount as a fallback, so a missed push is self-healing.
      void postStoredSettings();
      // In Dev Mode's Inspect panel the UI is an iframe Figma sizes, so neither mechanism below has
      // anything to act on. Verified live there: `figma.ui.resize` moves nothing, and the `run`
      // listener cannot undo a `hide()` — hiding empties the panel for good, so the control it
      // serves is withdrawn on the UI side too (see App.vue). Skipping both keeps the sandbox's
      // model of the panel matching the UI's, and keeps window APIs out of a panel they were never
      // written for.
      if (isEmbeddedInPanel(figmaCtx.mode ?? 'default')) return;
      void restoreStoredSize();
      // "Run in background" hides the panel rather than closing the plugin, so running it again
      // from the Plugins menu is what brings it back.
      figmaCtx.on('run', () => figmaCtx.ui.show());
    },

    apply: message => {
      switch (message.kind) {
        case 'panel-hide': {
          // `hide()` — not `closePlugin()`: the relay socket lives in that iframe, and closing
          // would drop the connection the user asked to keep.
          figmaCtx.ui.hide();
          return;
        }
        case 'panel-resize': {
          const size = clampPanelSize(message.width, message.height);
          resizeTo(size);
          // Sent only on drag-release, so the store holds the size the user settled on rather than
          // every intermediate frame of the drag.
          if (message.persist) {
            figmaCtx.clientStorage.setAsync(STORED_SIZE_KEY, size).catch(() => {});
          }
          return;
        }
        case 'panel-reveal': {
          void reveal(message.nodeIds);
          return;
        }
        case 'panel-settings-request': {
          void postStoredSettings();
          return;
        }
        case 'panel-settings': {
          const settings: ConnectionSettings = {
            host: message.host,
            port: message.port,
          };
          figmaCtx.clientStorage.setAsync(STORED_SETTINGS_KEY, settings).catch(() => {});
          // Echo back so the UI (and any other live tab) reflects the saved value.
          // figma.ui.postMessage is the Figma plugin API — there is no targetOrigin parameter
          // eslint-disable-next-line unicorn/require-post-message-target-origin
          figmaCtx.ui.postMessage(createPanelSettings(settings));
          return;
        }
      }
    },
  };
};
