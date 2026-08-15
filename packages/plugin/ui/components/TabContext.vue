<script setup lang="ts">
import { computed } from 'vue';

import type { PluginContextEvent } from '../../protocol/bridge.js';
import UiMetaRow from './UiMetaRow.vue';
import UiSection from './UiSection.vue';
import { useI18n, type Messages } from '../i18n/index.js';

const props = defineProps<{ context: PluginContextEvent | null }>();
const { t } = useI18n();

// Why writes will fail here, stated once where the user is already looking at the editor they're
// in. Without it a Dev Mode session looks identical to a Design one until a tool errors. The
// panel-localized text lives in the dictionary; the server keeps the English form for the agent.
const EDITOR_LIMIT_KEY: Record<string, keyof Messages> = {
  dev: 'editor.dev',
  figjam: 'editor.figjam',
};
const limitation = computed(() => {
  if (props.context === null) return null;
  const key = EDITOR_LIMIT_KEY[props.context.editorType];
  return key ? t(key) : null;
});

// `mode` only earns a slot when it isn't the ordinary one — in a floating plugin window it would
// be a constant, and this row is already carrying two other facts.
const editor = computed(() => {
  const c = props.context;
  if (c === null) return '';
  const launched = c.mode === 'default' ? c.editorType : `${c.editorType} · ${c.mode}`;
  return `${launched} · API ${c.apiVersion}`;
});

// Nodes the sandbox didn't serialize (it caps the detail count) — surfaced as an "…and N more" line.
const hiddenCount = computed(() =>
  props.context === null ? 0 : props.context.selectionCount - props.context.selection.length,
);
</script>

<template>
  <div v-if="context !== null" class="divide-y divide-line px-1.5">
    <UiSection>
      <dl class="space-y-1.5">
        <UiMetaRow :label="t('ctx.file')" truncate value-class="font-medium">
          {{ context.fileName }}
        </UiMetaRow>
        <UiMetaRow :label="t('ctx.page')" truncate value-class="font-medium">
          {{ context.pageName }}
        </UiMetaRow>
        <UiMetaRow :label="t('ctx.editor')" mono value-class="text-dim">
          {{ editor }}
        </UiMetaRow>
      </dl>

      <p
        v-if="limitation !== null"
        class="mt-1.5 rounded-md bg-raised p-1.5 text-meta wrap-break-word text-warning"
      >
        {{ limitation }}
      </p>
    </UiSection>

    <UiSection :title="t('ctx.selection', { n: context.selectionCount })">
      <ul v-if="context.selection.length > 0" class="space-y-0.5">
        <li
          v-for="node in context.selection"
          :key="node.id"
          class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-hover"
        >
          <span class="min-w-0 flex-1 truncate">{{ node.name }}</span>
          <span class="shrink-0 rounded bg-raised px-1 py-px font-mono text-chip text-dim">
            {{ node.type }}
          </span>
          <span class="shrink-0 text-meta text-faint tabular-nums">
            {{ node.width }}×{{ node.height }}
          </span>
        </li>
        <li v-if="hiddenCount > 0" class="px-1 text-dim">{{ t('ctx.more', { n: hiddenCount }) }}</li>
      </ul>
      <p v-else class="px-1 text-dim">{{ t('ctx.nothingSelected') }}</p>
    </UiSection>
  </div>
  <p v-else class="px-1.5 text-dim">{{ t('ctx.waiting') }}</p>
</template>
