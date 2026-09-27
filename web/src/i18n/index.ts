import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { LANG_OVERRIDE } from '../demo/mode'
import en from './locales/en'
import si from './locales/si'
import ta from './locales/ta'

/** EN · සිං · த. Driver and loader screens are fully translated; Sinhala and Tamil await native-speaker review. */
export const LANGUAGES = ['en', 'si', 'ta'] as const
export type Language = (typeof LANGUAGES)[number]

const STORAGE_KEY = 'kairon.lang'
const isLanguage = (v: unknown): v is Language => (LANGUAGES as readonly string[]).includes(v as string)

function initialLanguage(): Language {
  if (isLanguage(LANG_OVERRIDE)) return LANG_OVERRIDE
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(v)) return v
  } catch {
    // Storage can be unavailable (private mode); fall back to English.
  }
  return 'en'
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, si: { translation: si }, ta: { translation: ta } },
  lng: initialLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
  if (LANG_OVERRIDE) return
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    // Non-fatal: the choice just won't persist.
  }
})
document.documentElement.lang = i18n.language

export default i18n
