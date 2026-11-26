import zhCN from '../locales/zh-CN.json';
import zhTW from '../locales/zh-TW.json';
import enUS from '../locales/en-US.json';
import jaJP from '../locales/ja-JP.json';
import koKR from '../locales/ko-KR.json';

export type ShippedLocale = 'zh-CN' | 'zh-TW' | 'en-US' | 'ja-JP' | 'ko-KR';
export type LanguageSetting = 'auto' | ShippedLocale;

export const SHIPPED_LOCALES: readonly ShippedLocale[] = [
  'zh-CN',
  'zh-TW',
  'en-US',
  'ja-JP',
  'ko-KR',
];

const RAW_CATALOGS: Record<ShippedLocale, Record<string, unknown>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'ko-KR': koKR,
};

const FLAT_CATALOGS: Record<ShippedLocale, Record<string, string>> = {
  'zh-CN': {},
  'zh-TW': {},
  'en-US': {},
  'ja-JP': {},
  'ko-KR': {},
};

function flatten(prefix: string, obj: Record<string, unknown>, out: Record<string, string>): void {
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_version') continue;
    const next = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out[next] = v;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      flatten(next, v as Record<string, unknown>, out);
    }
  }
}

for (const loc of SHIPPED_LOCALES) {
  flatten('', RAW_CATALOGS[loc], FLAT_CATALOGS[loc]);
}

function isSimplifiedChinese(normalized: string): boolean {
  const parts = normalized.split('-');
  return !parts.some((p) => p === 'hant' || p === 'tw' || p === 'hk' || p === 'mo');
}

export function resolveLocaleTag(raw?: string | null): ShippedLocale {
  const clean = (raw || '').trim().split('.')[0].split('@')[0];
  if (!clean) return 'en-US';
  const normalized = clean.replace(/_/g, '-').toLowerCase();
  const primary = normalized.split('-')[0];
  if (primary === 'zh') {
    return isSimplifiedChinese(normalized) ? 'zh-CN' : 'zh-TW';
  }
  if (primary === 'ja') return 'ja-JP';
  if (primary === 'ko') return 'ko-KR';
  if (primary === 'en') return 'en-US';
  return 'en-US';
}

export function detectBrowserLocale(): ShippedLocale {
  const navLang =
    (typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) ||
    'zh-CN';
  return resolveLocaleTag(navLang);
}

export function normalizeLanguageSetting(raw?: string | null): LanguageSetting {
  const clean = (raw || '').trim();
  if (!clean || clean.toLowerCase() === 'auto') return 'auto';
  return resolveLocaleTag(clean);
}

let activeLocale: ShippedLocale = detectBrowserLocale();

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);
}

export function isWindowsPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || navigator.userAgent);
}

export function setActiveLocale(setting?: string | null, backendResolved?: string | null): ShippedLocale {
  const norm = normalizeLanguageSetting(setting);
  if (norm === 'auto') {
    activeLocale = backendResolved ? resolveLocaleTag(backendResolved) : detectBrowserLocale();
  } else {
    activeLocale = norm;
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = activeLocale;
  }
  return activeLocale;
}

export function getActiveLocale(): ShippedLocale {
  return activeLocale;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const raw =
    FLAT_CATALOGS[activeLocale]?.[key] ??
    FLAT_CATALOGS['en-US']?.[key] ??
    key;
  if (!vars) return raw;
  let out = raw;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return out;
}

export function localizeBreedName(id: string, fallbackName: string, builtin?: boolean): string {
  if (builtin !== false) {
    const key = `breeds.${id}`;
    const localized = FLAT_CATALOGS[activeLocale]?.[key];
    if (localized) return localized;
  }
  return fallbackName;
}

export function applyDomTranslations(root: Document | HTMLElement = document): void {
  const isMac = isMacPlatform();
  const resolveKey = (rawKey: string) =>
    rawKey === 'menu.toggle_lock'
      ? isMac
        ? 'menu.toggle_lock_macos'
        : 'menu.toggle_lock_windows'
      : rawKey;

  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const rawKey = el.dataset.i18n;
    if (!rawKey) return;
    el.textContent = t(resolveKey(rawKey));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const rawKey = el.dataset.i18nTitle;
    if (!rawKey) return;
    el.title = t(resolveKey(rawKey));
  });
}
