export type AppLanguageCode =
  | 'en'
  | 'zh'
  | 'hi'
  | 'es'
  | 'ar'
  | 'fr'
  | 'bn'
  | 'pt'
  | 'ru'
  | 'ur';

export type AppLanguage = {
  code: AppLanguageCode;
  englishName: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
};

export const APP_LANGUAGES: AppLanguage[] = [
  { code: 'en', englishName: 'English', nativeName: 'English', direction: 'ltr' },
  { code: 'zh', englishName: 'Chinese', nativeName: '中文', direction: 'ltr' },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', direction: 'ltr' },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', direction: 'ltr' },
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', direction: 'rtl' },
  { code: 'fr', englishName: 'French', nativeName: 'Français', direction: 'ltr' },
  { code: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', direction: 'ltr' },
  { code: 'pt', englishName: 'Portuguese', nativeName: 'Português', direction: 'ltr' },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский', direction: 'ltr' },
  { code: 'ur', englishName: 'Urdu', nativeName: 'اردو', direction: 'rtl' },
];

export const DEFAULT_APP_LANGUAGE: AppLanguageCode = 'en';

export function isAppLanguageCode(value: unknown): value is AppLanguageCode {
  return APP_LANGUAGES.some((language) => language.code === value);
}

export function getAppLanguage(code: AppLanguageCode) {
  return APP_LANGUAGES.find((language) => language.code === code) || APP_LANGUAGES[0];
}
