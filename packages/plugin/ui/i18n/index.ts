/**
 * Minimal i18n for the Figwright plugin UI.
 *
 * Why not a library: the plugin ships as one atomic build (sandbox + iframe), so there is no
 * version skew to absorb and no need for schema-heavy tooling. A typed dictionary + a `t()` with
 * `{param}` interpolation is the whole thing. Locale is detected from the browser and persisted in
 * the iframe's `localStorage`, mirroring the dashboard's `fp-lang` approach — no change to the
 * `figma.clientStorage` path is required.
 *
 * Reactivity: `t()` and `notice()` read the module-level `locale` ref, so any template that calls
 * them re-renders when the language flips. Pass `t`/`locale`/`setLocale`/`notice` down via
 * `useI18n()`.
 */

import { ref, type Ref } from 'vue';

import { en, type Messages } from './en.js';
import { zh } from './zh.js';

export type Locale = 'en' | 'zh';
export type { Messages };

const STORAGE_KEY = 'fw-locale';
const DICTS: Record<Locale, Messages> = { en, zh };

const detectLocale = (): Locale => {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* storage unavailable — fall through to auto-detect */
  }
  const nav = (globalThis.navigator?.language ?? 'en').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'en';
};

const locale: Ref<Locale> = ref(detectLocale());

export const getLocale = (): Locale => locale.value;

export const setLocale = (next: Locale): void => {
  locale.value = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable — the in-memory choice still applies this session */
  }
};

const interpolate = (template: string, params?: Record<string, string | number>): string => {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in params ? String(params[key]) : whole,
  );
};

export const t = (key: keyof Messages, params?: Record<string, string | number>): string => {
  void locale.value; // register as a reactive dependency
  const template = DICTS[locale.value][key] ?? en[key] ?? key;
  return interpolate(template, params);
};

const SKEW_URL = 'https://github.com/heyxiaoze/figwright-plus/releases/latest';

/**
 * Localize a server-originated notice (version skew / protocol mismatch) that arrives as English
 * prose. This is the low-risk path the UI takes instead of changing the server's wire format: we
 * match the known constants and rebuild with the captured versions. Anything unrecognized passes
 * through unchanged (English), so a future server wording simply degrades to English rather than
 * breaking.
 */
export const notice = (text: string | null | undefined): string | null => {
  if (!text) return text ?? null;
  void locale.value; // register as a reactive dependency
  const mismatch = text.match(/^protocol mismatch: server speaks (\S+), plugin speaks (\S+)/);
  if (mismatch) return t('notice.protocolMismatch', { server: mismatch[1] ?? '', plugin: mismatch[2] ?? '' });
  const skew = text.match(/Figwright plugin (?:v)?([\d.]+) is older than this server \(v([\d.]+)\)/);
  if (skew) return t('notice.skew', { plugin: skew[1] ?? '', server: skew[2] ?? '', url: SKEW_URL });
  return text;
};

export const useI18n = (): {
  t: typeof t;
  locale: Ref<Locale>;
  setLocale: typeof setLocale;
  getLocale: typeof getLocale;
  notice: typeof notice;
} => ({ t, locale, setLocale, getLocale, notice });
