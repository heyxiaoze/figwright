import { onMounted, ref, type Ref } from 'vue';

import {
  DEFAULT_CONNECTION_SETTINGS,
  type ConnectionSettings,
} from '../../protocol/panel-control.js';
import {
  onSandboxSettings,
  requestConnectionSettings,
  saveConnectionSettings,
} from '../sandbox/messaging.js';

export interface ConnectionSettingsStore {
  /** Reactive copy of the configured connection target (host/port/token). */
  settings: Ref<ConnectionSettings>;
  /** True once the sandbox has answered our initial request (or a save has happened). */
  initialized: Ref<boolean>;
  /** Persist new settings to the sandbox and adopt them locally (triggers a relay reconnect). */
  save: (next: ConnectionSettings) => void;
}

/**
 * Owns the panel's view of connection settings. The iframe cannot reach `figma.clientStorage`, so
 * the sandbox is the source of truth: this asks for the stored values on mount and adopts whatever
 * the sandbox pushes down. Saving posts the new values up; the sandbox persists and echoes them
 * back, which also updates this store (the echo is idempotent).
 *
 * Lives beside the relay session rather than inside it because settings are a user-facing concern
 * (the Settings tab edits them) that happens to drive the relay client — keeping it separate lets
 * the tab bind the form directly without threading the session through the UI tree.
 */
export const useConnectionSettings = (): ConnectionSettingsStore => {
  const settings = ref<ConnectionSettings>({ ...DEFAULT_CONNECTION_SETTINGS });
  const initialized = ref(false);

  onSandboxSettings(received => {
    settings.value = received;
    initialized.value = true;
  });

  onMounted(() => {
    // The sandbox also pushes settings on open; this request is the fallback if that push is missed
    // (e.g. the iframe wasn't ready yet). Either way, settings converge to the stored values.
    requestConnectionSettings();
  });

  const save = (next: ConnectionSettings): void => {
    settings.value = next;
    initialized.value = true;
    saveConnectionSettings(next);
  };

  return { settings, initialized, save };
};
