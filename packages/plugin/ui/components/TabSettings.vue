<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';

import type { ConnectionSettings } from '../../protocol/panel-control.js';
import { RelayClient } from '../relay/client.js';
import type { RelayClientState } from '../relay/state.js';
import { copyToClipboard } from '../lib/clipboard.js';
import { useI18n } from '../i18n/index.js';
import UiSection from './UiSection.vue';

const { t, notice, locale, setLocale } = useI18n();

const props = defineProps<{
  /** The currently-applied connection target (host/port). */
  settings: ConnectionSettings;
  /** Persist (and apply) new settings. */
  save: (next: ConnectionSettings) => void;
  /** Live relay client state, for the diagnostics panel. */
  state: RelayClientState;
}>();

// Editable local copy so typing doesn't fight the applied source until Save is pressed.
const form = reactive<ConnectionSettings>({
  host: props.settings.host,
  port: props.settings.port,
});

// Adopt external changes (the sandbox echo, or a reset) without clobbering mid-edit is acceptable —
// these only arrive on open or after a save, never while the user is typing.
watch(
  () => props.settings,
  s => {
    form.host = s.host;
    form.port = s.port;
  },
);

const target = computed(() => `ws://${form.host}:${form.port}`);

const portError = computed(() => {
  const p = Number(form.port);
  return !Number.isInteger(p) || p <= 0 || p > 65_535;
});

// A bad port is the only thing that should block saving.
const canSave = computed(() => !portError.value);

const onSave = (): void => {
  if (portError.value) return;
  props.save({ host: form.host.trim(), port: Number(form.port) });
};

// --- Clipboard feedback ----------------------------------------------------------------------
const flash = ref('');
let flashTimer: ReturnType<typeof setTimeout> | undefined;
const copy = async (text: string, label: string): Promise<void> => {
  const ok = await copyToClipboard(text);
  flash.value = ok ? t('set.copied', { label }) : t('set.copyFailed', { label });
  if (flashTimer !== undefined) clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flash.value = '';
  }, 1500);
};

// --- Connection diagnostics ------------------------------------------------------------------
// Translate the client's raw `lastError` into something actionable. The client already captures
// why a connection failed; the UI just never surfaced it — so a failed LAN connection read as a
// bare "Disconnected" with no hint where to look.
const describeError = (err: string): string => {
  const e = err.toLowerCase();
  if (
    e.includes('socket error') ||
    e.includes('refused') ||
    e.includes('unreachable') ||
    e.includes('network') ||
    e.includes('failed')
  ) {
    return t('set.connError');
  }
  return err;
};

const connError = computed(() => {
  if (props.state.status === 'connected') return null;
  return props.state.lastError === null ? null : notice(describeError(props.state.lastError));
});

// "Test connection" opens a throwaway RelayClient against the current form values and reports
// whether the handshake succeeds, without disturbing the live panel connection.
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);
let testStop: (() => void) | undefined;
let testTimer: ReturnType<typeof setTimeout> | undefined;

const onTest = (): void => {
  if (testing.value) return;
  if (portError.value) {
    testResult.value = { ok: false, message: t('set.portError') };
    return;
  }
  testing.value = true;
  testResult.value = null;

  const client = new RelayClient({
    ports: [Number(form.port)],
    clientVersion: __APP_VERSION__,
    host: form.host.trim(),
    log: () => {},
  });

  let finished = false;
  const done = (ok: boolean, message: string): void => {
    if (finished) return;
    finished = true;
    if (testTimer !== undefined) clearTimeout(testTimer);
    testStop?.();
    client.disconnect().catch(() => {});
    testing.value = false;
    testResult.value = { ok, message };
  };

  testStop = client.subscribe(s => {
    if (s.status === 'connected') {
      const server = s.serverVersion === null ? '' : t('set.connectedServer', { v: s.serverVersion });
      done(true, t('set.connected') + server);
    } else if (s.status === 'disconnected' && s.lastError !== null) {
      done(false, notice(describeError(s.lastError)) ?? '');
    }
  });
  testTimer = setTimeout(() => done(false, t('set.testTimeout')), 3000);
  // The handshake result (success or a host error) surfaces via the subscribe() callbacks
  // above; swallowing connect()'s rejection here just avoids an unhandled-promise crash.
  void client.connect().catch(() => {});
};

onBeforeUnmount(() => {
  if (flashTimer !== undefined) clearTimeout(flashTimer);
  if (testTimer !== undefined) clearTimeout(testTimer);
  testStop?.();
});
</script>

<template>
  <UiSection :title="t('set.language')">
    <div class="mt-1 flex gap-2">
      <button
        type="button"
        class="rounded-md border px-3 py-1.5 text-panel transition-colors"
        :class="locale === 'zh' ? 'border-brand bg-brand/10 text-brand' : 'border-line text-dim hover:text-fg'"
        @click="setLocale('zh')"
      >
        中文
      </button>
      <button
        type="button"
        class="rounded-md border px-3 py-1.5 text-panel transition-colors"
        :class="locale === 'en' ? 'border-brand bg-brand/10 text-brand' : 'border-line text-dim hover:text-fg'"
        @click="setLocale('en')"
      >
        English
      </button>
    </div>
  </UiSection>

  <UiSection :title="t('set.connection')">
    <p class="text-meta text-dim">{{ t('set.connectionHint') }}</p>

    <label class="mt-3 block">
      <span class="text-meta text-dim">{{ t('set.host') }}</span>
      <input
        v-model="form.host"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="mt-1 w-full rounded-md border border-line bg-raised px-2 py-1.5 text-panel text-fg outline-none focus:border-brand"
        :placeholder="t('set.hostPlaceholder')"
      />
    </label>

    <label class="mt-2 block">
      <span class="text-meta text-dim">{{ t('set.port') }}</span>
      <input
        v-model="form.port"
        type="number"
        min="1"
        max="65535"
        class="mt-1 w-full rounded-md border border-line bg-raised px-2 py-1.5 text-panel text-fg outline-none focus:border-brand"
        :class="portError ? 'border-danger' : ''"
      />
      <span v-if="portError" class="mt-1 block text-meta text-danger"
        >{{ t('set.portError') }}</span
      >
    </label>

    <div class="mt-3 rounded-md bg-raised px-2 py-1.5">
      <div class="flex items-center justify-between gap-2">
        <span class="text-meta text-dim">{{ t('set.connectionTarget') }}</span>
        <button
          type="button"
          class="shrink-0 text-meta text-brand transition-opacity hover:underline"
          @click="copy(target, t('set.copyTargetLabel'))"
        >
          {{ t('set.copy') }}
        </button>
      </div>
      <div class="mt-0.5 truncate font-mono text-meta text-fg">{{ target }}</div>
    </div>
    <p v-if="flash" class="mt-1 text-meta text-success">{{ flash }}</p>

    <div class="mt-3 flex items-center gap-2">
      <button
        type="button"
        :disabled="!canSave"
        class="save-btn rounded-md px-3 py-1.5 text-panel font-medium transition-all duration-150"
        :class="[
          canSave
            ? 'bg-brand text-bg hover:bg-brand/90 active:scale-[0.97] active:bg-brand/80 cursor-pointer'
            : 'bg-raised text-dim/40 border border-line cursor-not-allowed',
        ]"
        @click="onSave"
      >
        {{ t('set.saveReconnect') }}
      </button>
    </div>
  </UiSection>

  <UiSection :title="t('set.diagnostics')">
    <template v-if="state.status === 'connected'">
      <p class="text-meta text-success">
        {{ t('set.connected') }}{{ state.serverVersion === null ? '' : t('set.connectedServer', { v: state.serverVersion }) }}
      </p>
    </template>
    <template v-else>
      <p class="text-meta text-dim">{{ t('set.currentStatus', { status: state.status }) }}</p>
      <p v-if="connError" class="mt-1 text-meta text-danger">{{ connError }}</p>
    </template>
    <p v-if="state.versionNotice" class="mt-1 text-meta text-warning">
      {{ t('set.versionNotice', { notice: notice(state.versionNotice) ?? '' }) }}
    </p>

    <div class="mt-3 flex items-center gap-2">
      <button
        type="button"
        :disabled="testing"
        class="rounded-md border border-line px-3 py-1.5 text-panel text-dim transition-colors hover:text-fg disabled:opacity-40"
        @click="onTest"
      >
        {{ t('set.testConnection') }}
      </button>
      <span v-if="testing" class="text-meta text-dim">{{ t('set.testing') }}</span>
      <span
        v-else-if="testResult"
        class="text-meta"
        :class="testResult.ok ? 'text-success' : 'text-danger'"
        >{{ testResult.message }}</span
      >
    </div>
    <p class="mt-1 text-meta text-faint">
      {{ t('set.testHandshakeHint') }}
    </p>
  </UiSection>
</template>
