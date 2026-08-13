<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

import { DEFAULT_PORT } from '@figwright/shared';
import type { ConnectionSettings } from '../../protocol/panel-control.js';
import UiSection from './UiSection.vue';

const props = defineProps<{
  /** The currently-applied connection target (host/port/token). */
  settings: ConnectionSettings;
  /** Persist (and apply) new settings. */
  save: (next: ConnectionSettings) => void;
}>();

// Editable local copy so typing doesn't fight the applied source until Save is pressed.
const form = reactive<ConnectionSettings>({
  host: props.settings.host,
  port: props.settings.port,
  token: props.settings.token,
});

// Adopt external changes (the sandbox echo, or a reset) without clobbering mid-edit is acceptable —
// these only arrive on open or after a save, never while the user is typing.
watch(
  () => props.settings,
  s => {
    form.host = s.host;
    form.port = s.port;
    form.token = s.token;
  },
);

const target = computed(() => `ws://${form.host}:${form.port}`);

// Loopback stays the implicit boundary (no token); anything else is LAN mode, where the server
// requires the token on every connection — so the field is mandatory there.
const isLan = computed(
  () => form.host !== '127.0.0.1' && form.host !== 'localhost' && form.host !== '::1' && form.host !== '',
);

const portError = computed(() => {
  const p = Number(form.port);
  return !Number.isInteger(p) || p <= 0 || p > 65_535;
});

const tokenMissing = computed(() => isLan.value && form.token.trim() === '');

const canSave = computed(() => !portError.value && !tokenMissing.value);

const onSave = (): void => {
  if (!canSave.value) return;
  props.save({ host: form.host.trim(), port: Number(form.port), token: form.token });
};

const resetLoopback = (): void => {
  form.host = '127.0.0.1';
  form.port = DEFAULT_PORT;
  form.token = '';
};
</script>

<template>
  <UiSection title="Connection">
    <p class="text-meta text-dim">
      The plugin connects to the Figwright server over this target. The default
      <span class="text-fg">127.0.0.1</span> keeps everything on this machine. To run the plugin on
      another machine, set <span class="text-fg">Host</span> to the server's LAN address and enter the
      server's token.
    </p>

    <label class="mt-3 block">
      <span class="text-meta text-dim">Host</span>
      <input
        v-model="form.host"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="mt-1 w-full rounded-md border border-line bg-raised px-2 py-1.5 text-panel text-fg outline-none focus:border-brand"
        placeholder="127.0.0.1"
      />
    </label>

    <label class="mt-2 block">
      <span class="text-meta text-dim">Port</span>
      <input
        v-model="form.port"
        type="number"
        min="1"
        max="65535"
        class="mt-1 w-full rounded-md border border-line bg-raised px-2 py-1.5 text-panel text-fg outline-none focus:border-brand"
        :class="portError ? 'border-danger' : ''"
      />
      <span v-if="portError" class="mt-1 block text-meta text-danger">Enter a port between 1 and 65535.</span>
    </label>

    <label class="mt-2 block">
      <span class="text-meta text-dim">Token</span>
      <input
        v-model="form.token"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="mt-1 w-full rounded-md border border-line bg-raised px-2 py-1.5 text-panel text-fg outline-none focus:border-brand"
        :class="tokenMissing ? 'border-danger' : ''"
        placeholder="required in LAN mode"
      />
      <span v-if="tokenMissing" class="mt-1 block text-meta text-danger">
        A token is required when Host is not loopback — copy it from the server's startup log.
      </span>
    </label>

    <div class="mt-3 rounded-md bg-raised px-2 py-1.5">
      <span class="text-meta text-dim">Connection target</span>
      <div class="mt-0.5 truncate font-mono text-meta text-fg">{{ target }}</div>
    </div>

    <div class="mt-3 flex items-center gap-2">
      <button
        type="button"
        :disabled="!canSave"
        class="rounded-md bg-brand px-3 py-1.5 text-panel font-medium text-bg transition-opacity disabled:opacity-40"
        @click="onSave"
      >
        Save &amp; reconnect
      </button>
      <button
        type="button"
        class="rounded-md border border-line px-3 py-1.5 text-panel text-dim transition-colors hover:text-fg"
        @click="resetLoopback"
      >
        Reset to loopback
      </button>
    </div>
  </UiSection>
</template>
