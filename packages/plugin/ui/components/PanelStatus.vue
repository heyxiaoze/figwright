<script setup lang="ts">
import { computed } from 'vue';

import { useSharedNow } from '../composables/useSharedNow.js';
import { formatRelativeTime } from '../lib/format.js';
import type { RelayStatus } from '../relay/state.js';
import { useI18n, type Messages } from '../i18n/index.js';

const props = defineProps<{
  status: RelayStatus;
  /** Host the relay is targeting (127.0.0.1 on loopback, a LAN address in LAN mode). */
  host: string;
  port: number | null;
  connectedAt: number | null;
  /** Most-recent connection failure reason (e.g. token rejected, host unreachable). */
  lastError?: string | null;
}>();

const { t, notice } = useI18n();

const STATUS_KEY: Record<RelayStatus, keyof Messages> = {
  idle: 'status.idle',
  connecting: 'status.connecting',
  connected: 'status.connected',
  reconnecting: 'status.reconnecting',
  disconnected: 'status.disconnected',
};

// The dot is `bg-current`, so a text color drives both the fill and its glow.
const STATUS_TONE = {
  idle: 'text-faint',
  connecting: 'text-warning',
  connected: 'text-success',
  reconnecting: 'text-warning',
  disconnected: 'text-danger',
} satisfies Record<RelayStatus, string>;

const now = useSharedNow();

// A connection that is still settling gets a pulsing ring; a live one gets a steady glow.
const settling = computed(() => props.status === 'connecting' || props.status === 'reconnecting');

const meta = computed(() => {
  if (props.status !== 'connected') return '';
  const host = props.host || '127.0.0.1';
  const port = props.port === null ? '' : `:${props.port}`;
  const up =
    props.connectedAt === null
      ? ''
      : ` · up ${formatRelativeTime(props.connectedAt, now.value.getTime())}`;
  return `ws://${host}${port}${up}`;
});

// The raw failure reason, shown only while not connected so a transient "looking for a server that
// isn't up yet" doesn't read as an error — but a real refusal (bad token, unreachable host) does.
// Server-originated notices (version skew / protocol mismatch) are localized on the fly.
const errorHint = computed(() =>
  props.status === 'connected' ? null : notice(props.lastError ?? null),
);
</script>

<template>
  <div class="min-w-0 flex-1">
    <div class="flex items-center gap-2.5">
      <span class="relative flex size-2 shrink-0" :class="STATUS_TONE[status]">
        <span v-if="settling" class="absolute inset-0 animate-ping-ring rounded-full bg-current" />
        <span
          class="relative size-2 rounded-full bg-current"
          :class="status === 'connected' ? 'shadow-[0_0_7px_currentColor]' : ''"
        />
      </span>
      <span class="font-medium tracking-tight text-fg">{{ t(STATUS_KEY[status]) }}</span>
      <span class="ml-auto min-w-0 truncate text-meta text-faint tabular-nums">{{ meta }}</span>
    </div>
    <p v-if="errorHint" class="mt-1 truncate text-meta text-danger" :title="errorHint">
      {{ errorHint }}
    </p>
  </div>
</template>
