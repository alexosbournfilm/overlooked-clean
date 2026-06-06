import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLanguageCode } from './languages';
import { STATIC_UI_PHRASES } from './staticPhrases';

const BRAND_TOKEN = 'OVRLOOKEDBRANDTOKEN';
const MAX_CONCURRENT_TRANSLATIONS = 8;

const TARGET_LANGUAGE_CODES: Record<AppLanguageCode, string> = {
  en: 'en',
  zh: 'zh-CN',
  hi: 'hi',
  es: 'es',
  ar: 'ar',
  fr: 'fr',
  bn: 'bn',
  pt: 'pt',
  ru: 'ru',
  ur: 'ur',
};

const cacheByLanguage = new Map<AppLanguageCode, Map<string, string>>();
const loadedLanguages = new Set<AppLanguageCode>();
const loadingLanguages = new Map<AppLanguageCode, Promise<void>>();
const inflight = new Set<string>();
const queue: Array<{ language: AppLanguageCode; text: string }> = [];
const subscribers = new Set<() => void>();

let activeTranslations = 0;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function normalizePhrase(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

const NORMALIZED_STATIC_UI_PHRASES = new Set(
  Array.from(STATIC_UI_PHRASES, (phrase) => normalizePhrase(phrase))
);

function cacheKey(language: AppLanguageCode) {
  return `OVERLOOKED_TRANSLATION_CACHE:${language}`;
}

function getLanguageCache(language: AppLanguageCode) {
  let cache = cacheByLanguage.get(language);
  if (!cache) {
    cache = new Map<string, string>();
    cacheByLanguage.set(language, cache);
  }
  return cache;
}

function protectBrand(value: string) {
  return value.replace(/Overlooked/g, BRAND_TOKEN);
}

function restoreBrand(value: string) {
  return value.replace(new RegExp(BRAND_TOKEN, 'g'), 'Overlooked');
}

function scheduleNotify() {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    subscribers.forEach((listener) => listener());
  }, 32);
}

async function loadLanguageCache(language: AppLanguageCode) {
  if (language === 'en' || loadedLanguages.has(language)) return;

  const existing = loadingLanguages.get(language);
  if (existing) return existing;

  const task = AsyncStorage.getItem(cacheKey(language))
    .then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string>;
      const cache = getLanguageCache(language);
      Object.entries(parsed).forEach(([source, translated]) => {
        if (typeof source === 'string' && typeof translated === 'string') {
          cache.set(source, translated);
        }
      });
    })
    .catch(() => {})
    .finally(() => {
      loadedLanguages.add(language);
      loadingLanguages.delete(language);
    });

  loadingLanguages.set(language, task);
  return task;
}

async function persistLanguageCache(language: AppLanguageCode) {
  try {
    const cache = getLanguageCache(language);
    await AsyncStorage.setItem(cacheKey(language), JSON.stringify(Object.fromEntries(cache)));
  } catch {}
}

async function translateViaGoogle(source: string, language: AppLanguageCode) {
  const target = TARGET_LANGUAGE_CODES[language];
  const protectedSource = protectBrand(source);
  const url =
    'https://translate.googleapis.com/translate_a/single' +
    `?client=gtx&sl=en&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(protectedSource)}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Translation failed: ${response.status}`);

  const json = await response.json();
  const translated = Array.isArray(json?.[0])
    ? json[0].map((part: any[]) => part?.[0] || '').join('')
    : '';

  return restoreBrand(translated || source);
}

async function translateViaMyMemory(source: string, language: AppLanguageCode) {
  const target = TARGET_LANGUAGE_CODES[language];
  const protectedSource = protectBrand(source);
  const url =
    'https://api.mymemory.translated.net/get' +
    `?langpair=en|${encodeURIComponent(target)}&q=${encodeURIComponent(protectedSource)}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fallback translation failed: ${response.status}`);

  const json = await response.json();
  const translated = json?.responseData?.translatedText;
  return restoreBrand(typeof translated === 'string' && translated ? translated : source);
}

async function fetchTranslation(source: string, language: AppLanguageCode) {
  try {
    return await translateViaGoogle(source, language);
  } catch {
    return translateViaMyMemory(source, language);
  }
}

function processQueue() {
  while (activeTranslations < MAX_CONCURRENT_TRANSLATIONS && queue.length) {
    const item = queue.shift();
    if (!item) return;

    const key = `${item.language}:${item.text}`;
    activeTranslations += 1;

    void (async () => {
      try {
        await loadLanguageCache(item.language);
        const cache = getLanguageCache(item.language);
        if (!cache.has(item.text)) {
          const translated = await fetchTranslation(item.text, item.language);
          cache.set(item.text, translated);
          void persistLanguageCache(item.language);
          scheduleNotify();
        }
      } catch {
        // Keep English visible if network translation is unavailable.
      } finally {
        inflight.delete(key);
        activeTranslations -= 1;
        processQueue();
      }
    })();
  }
}

export function isStaticUiPhrase(value: string) {
  const normalized = normalizePhrase(value);
  if (NORMALIZED_STATIC_UI_PHRASES.has(normalized)) return true;

  if (normalized.includes('•')) {
    return normalized
      .split('•')
      .every((part) => {
        const piece = normalizePhrase(part);
        return !piece || NORMALIZED_STATIC_UI_PHRASES.has(piece);
      });
  }

  return false;
}

export function getCachedDynamicTranslation(value: string, language: AppLanguageCode) {
  if (language === 'en') return null;
  const normalized = normalizePhrase(value);
  return getLanguageCache(language).get(normalized) || null;
}

export function requestDynamicTranslation(
  value: string,
  language: AppLanguageCode,
  options: { allowUnregistered?: boolean } = {}
) {
  if (language === 'en') return;

  const normalized = normalizePhrase(value);
  if (!normalized || (!options.allowUnregistered && !isStaticUiPhrase(normalized))) return;

  void loadLanguageCache(language).then(() => scheduleNotify());

  if (getLanguageCache(language).has(normalized)) return;

  const key = `${language}:${normalized}`;
  if (inflight.has(key)) return;

  inflight.add(key);
  queue.unshift({ language, text: normalized });
  processQueue();
}

export function subscribeDynamicTranslationUpdates(listener: () => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
