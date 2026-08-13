<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';

import { DEFAULT_PORT } from '@figwright/shared';
import type { ConnectionSettings } from '../../protocol/panel-control.js';
import { RelayClient } from '../relay/client.js';
import type { RelayClientState } from '../relay/state.js';
import { parseInvite } from '../lib/invite.js';
import { copyToClipboard } from '../lib/clipboard.js';
import UiSection from './UiSection.vue';

const props = defineProps<{
  /** The currently-applied connection target (host/port/token). */
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

// --- Quick-connect via invite string ---------------------------------------------------------
// The server prints one-line `figwright://connect?host=&port=&token=` in LAN mode; pasting it fills
// the three fields in one go so the user never transcribes the 32-char token by hand.
const inviteRaw = ref('');
const inviteError = ref<string | null>(null);

const applyInvite = (): void => {
  const parsed = parseInvite(inviteRaw.value);
  if (parsed === null) {
    inviteError.value =
      '无法识别的邀请串：应以 figwright://connect? 开头，且包含 host / port / token。';
    return;
  }
  form.host = parsed.host;
  form.port = parsed.port;
  form.token = parsed.token;
  inviteError.value = null;
  inviteRaw.value = '';
};

// --- Clipboard feedback ----------------------------------------------------------------------
const flash = ref('');
let flashTimer: ReturnType<typeof setTimeout> | undefined;
const copy = async (text: string, label: string): Promise<void> => {
  const ok = await copyToClipboard(text);
  flash.value = ok ? `${label}已复制` : `${label}复制失败`;
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
  if (e.includes('token') || e.includes('hello rejected') || e.includes('unauthorized')) {
    return '连接被拒绝：Token 不正确，或服务器未开启 LAN 模式（未在 FIGWRIGHT_HOST 绑定非回环地址）。';
  }
  if (
    e.includes('socket error') ||
    e.includes('refused') ||
    e.includes('unreachable') ||
    e.includes('network') ||
    e.includes('failed')
  ) {
    return '无法连接：确认 Host/IP 与端口正确、服务器已启动，且本机网络可达该地址。';
  }
  return err;
};

const connError = computed(() => {
  if (props.state.status === 'connected') return null;
  return props.state.lastError === null ? null : describeError(props.state.lastError);
});

// "Test connection" opens a throwaway RelayClient against the current form values and reports
// whether the handshake (incl. token) succeeds, without disturbing the live panel connection.
const testing = ref(false);
const testResult = ref<{ ok: boolean; message: string } | null>(null);
let testStop: (() => void) | undefined;
let testTimer: ReturnType<typeof setTimeout> | undefined;

const onTest = (): void => {
  if (testing.value) return;
  if (portError.value) {
    testResult.value = { ok: false, message: '端口无效，无法测试' };
    return;
  }
  if (tokenMissing.value) {
    testResult.value = { ok: false, message: 'LAN 模式需要先填写 Token' };
    return;
  }
  testing.value = true;
  testResult.value = null;

  const client = new RelayClient({
    ports: [Number(form.port)],
    clientVersion: __APP_VERSION__,
    host: form.host.trim(),
    token: form.token === '' ? undefined : form.token,
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
      done(true, `连接成功（服务器 v${s.serverVersion ?? '未知'}）`);
    } else if (s.status === 'disconnected' && s.lastError !== null) {
      done(false, describeError(s.lastError));
    }
  });
  testTimer = setTimeout(() => done(false, '超时：3 秒内未建立连接'), 3000);
  client.connect().catch(err => done(false, describeError(String(err))));
};

onBeforeUnmount(() => {
  if (flashTimer !== undefined) clearTimeout(flashTimer);
  if (testTimer !== undefined) clearTimeout(testTimer);
  testStop?.();
});
</script>

<template>
  <UiSection title="快速连接（邀请）">
    <p class="text-meta text-dim">
      把服务器启动日志里的 <span class="text-fg">invite</span> 一行整段粘贴进来，自动填好 Host / Port /
      Token，免去手抄长 Token。
    </p>
    <div class="mt-2 flex gap-2">
      <input
        v-model="inviteRaw"
        type="text"
        spellcheck="false"
        autocomplete="off"
        class="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1.5 text-panel text-fg outline-none focus:border-brand"
        placeholder="figwright://connect?host=…&port=3055&token=…"
      />
      <button
        type="button"
        class="shrink-0 rounded-md border border-line px-3 py-1.5 text-panel text-dim transition-colors hover:text-fg"
        @click="applyInvite"
      >
        填入
      </button>
    </div>
    <p v-if="inviteError" class="mt-1 text-meta text-danger">{{ inviteError }}</p>
  </UiSection>

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
      <span v-if="portError" class="mt-1 block text-meta text-danger"
        >Enter a port between 1 and 65535.</span
      >
    </label>

    <label class="mt-2 block">
      <span class="flex items-center justify-between">
        <span class="text-meta text-dim">Token</span>
        <button
          type="button"
          class="text-meta text-brand transition-opacity hover:underline disabled:opacity-40"
          :disabled="form.token === ''"
          @click="copy(form.token, 'Token')"
        >
          复制
        </button>
      </span>
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
        A token is required when Host is not loopback — paste the server's invite, or copy it from the
        server's startup log.
      </span>
    </label>

    <div class="mt-3 rounded-md bg-raised px-2 py-1.5">
      <div class="flex items-center justify-between gap-2">
        <span class="text-meta text-dim">Connection target</span>
        <button
          type="button"
          class="shrink-0 text-meta text-brand transition-opacity hover:underline"
          @click="copy(target, '连接地址')"
        >
          复制
        </button>
      </div>
      <div class="mt-0.5 truncate font-mono text-meta text-fg">{{ target }}</div>
    </div>
    <p v-if="flash" class="mt-1 text-meta text-success">{{ flash }}</p>

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

  <UiSection title="连接诊断">
    <template v-if="state.status === 'connected'">
      <p class="text-meta text-success">
        已连接{{ state.serverVersion === null ? '' : `（服务器 v${state.serverVersion}）` }}
      </p>
    </template>
    <template v-else>
      <p class="text-meta text-dim">当前状态：{{ state.status }}</p>
      <p v-if="connError" class="mt-1 text-meta text-danger">{{ connError }}</p>
    </template>
    <p v-if="state.versionNotice" class="mt-1 text-meta text-warning">
      版本提示：{{ state.versionNotice }}
    </p>

    <div class="mt-3 flex items-center gap-2">
      <button
        type="button"
        :disabled="testing"
        class="rounded-md border border-line px-3 py-1.5 text-panel text-dim transition-colors hover:text-fg disabled:opacity-40"
        @click="onTest"
      >
        测试连接
      </button>
      <span v-if="testing" class="text-meta text-dim">测试中…</span>
      <span
        v-else-if="testResult"
        class="text-meta"
        :class="testResult.ok ? 'text-success' : 'text-danger'"
        >{{ testResult.message }}</span
      >
    </div>
    <p class="mt-1 text-meta text-faint">
      用当前表单的 Host / Port / Token 临时握手一次，不影响已保存的连接。
    </p>
  </UiSection>
</template>
