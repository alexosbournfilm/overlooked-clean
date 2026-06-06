import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  APP_LANGUAGES,
  AppLanguageCode,
  DEFAULT_APP_LANGUAGE,
  getAppLanguage,
  isAppLanguageCode,
} from '../i18n/languages';
import { translateText } from '../i18n/translations';
import { subscribeDynamicTranslationUpdates } from '../i18n/dynamicTranslation';

const LANGUAGE_STORAGE_KEY = 'OVERLOOKED_APP_LANGUAGE';

let currentLanguage: AppLanguageCode = DEFAULT_APP_LANGUAGE;
const subscribers = new Set<(language: AppLanguageCode) => void>();

function setGlobalLanguage(language: AppLanguageCode) {
  currentLanguage = language;
  subscribers.forEach((listener) => listener(language));
}

export function getCurrentAppLanguage() {
  return currentLanguage;
}

export function subscribeToAppLanguage(listener: (language: AppLanguageCode) => void) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

type LanguageContextValue = {
  language: AppLanguageCode;
  languageMeta: ReturnType<typeof getAppLanguage>;
  languages: typeof APP_LANGUAGES;
  setLanguage: (language: AppLanguageCode) => Promise<void>;
  t: (value: string) => string;
};

const LanguageContext = createContext<LanguageContextValue>({
  language: DEFAULT_APP_LANGUAGE,
  languageMeta: getAppLanguage(DEFAULT_APP_LANGUAGE),
  languages: APP_LANGUAGES,
  setLanguage: async () => {},
  t: (value: string) => value,
});

export function AppLanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguageCode>(currentLanguage);
  const [translationVersion, setTranslationVersion] = useState(0);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY)
      .then((stored) => {
        if (!mounted || !isAppLanguageCode(stored)) return;
        setLanguageState(stored);
        setGlobalLanguage(stored);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const setLanguage = useCallback(async (nextLanguage: AppLanguageCode) => {
    setLanguageState(nextLanguage);
    setGlobalLanguage(nextLanguage);
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {}
  }, []);

  useEffect(() => {
    if (language === 'en') return undefined;
    return subscribeDynamicTranslationUpdates(() => {
      setTranslationVersion((version) => version + 1);
    });
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      languageMeta: getAppLanguage(language),
      languages: APP_LANGUAGES,
      setLanguage,
      t: (text: string) => translateText(text, language),
    }),
    [language, setLanguage, translationVersion]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useAppLanguage() {
  return useContext(LanguageContext);
}
