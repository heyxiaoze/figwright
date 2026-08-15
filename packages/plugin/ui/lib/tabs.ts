export type Tab = 'activity' | 'context' | 'debug' | 'settings';

/**
 * Tab order drives both the button row and the sliding indicator's offset. The second element is an
 * i18n key (see `ui/i18n`); the label is resolved with `t()` in `PanelTabs`.
 */
export const TABS = [
  ['activity', 'tab.activity'],
  ['context', 'tab.context'],
  ['debug', 'tab.debug'],
  ['settings', 'tab.settings'],
] as const satisfies ReadonlyArray<readonly [Tab, string]>;
