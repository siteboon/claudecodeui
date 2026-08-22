/**
 * i18n Configuration
 *
 * Configures i18next for internationalization support.
 * Features:
 * - Lazy-loading of translation namespaces
 * - Language detection from localStorage
 * - Fallback to English for missing translations
 * - Development mode warnings for missing keys
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translation resources
import enCommon from '@/modules/i18n/locales/en/common.json';
import enSettings from '@/modules/i18n/locales/en/settings.json';
import enAuth from '@/modules/i18n/locales/en/auth.json';
import enSidebar from '@/modules/i18n/locales/en/sidebar.json';
import enChat from '@/modules/i18n/locales/en/chat.json';
import enCodeEditor from '@/modules/i18n/locales/en/codeEditor.json';
// oxlint-disable-next-line importx/order
import enTasks from '@/modules/i18n/locales/en/tasks.json';

import frCommon from '@/modules/i18n/locales/fr/common.json';
import frSettings from '@/modules/i18n/locales/fr/settings.json';
import frAuth from '@/modules/i18n/locales/fr/auth.json';
import frSidebar from '@/modules/i18n/locales/fr/sidebar.json';
import frChat from '@/modules/i18n/locales/fr/chat.json';
import frCodeEditor from '@/modules/i18n/locales/fr/codeEditor.json';
// oxlint-disable-next-line importx/order
import frTasks from '@/modules/i18n/locales/fr/tasks.json';

import esCommon from '@/modules/i18n/locales/es/common.json';
import esSettings from '@/modules/i18n/locales/es/settings.json';
import esAuth from '@/modules/i18n/locales/es/auth.json';
import esSidebar from '@/modules/i18n/locales/es/sidebar.json';
import esChat from '@/modules/i18n/locales/es/chat.json';
import esCodeEditor from '@/modules/i18n/locales/es/codeEditor.json';
// oxlint-disable-next-line importx/order
import esTasks from '@/modules/i18n/locales/es/tasks.json';

import koCommon from '@/modules/i18n/locales/ko/common.json';
import koSettings from '@/modules/i18n/locales/ko/settings.json';
import koAuth from '@/modules/i18n/locales/ko/auth.json';
import koSidebar from '@/modules/i18n/locales/ko/sidebar.json';
import koChat from '@/modules/i18n/locales/ko/chat.json';
import koCodeEditor from '@/modules/i18n/locales/ko/codeEditor.json';
// oxlint-disable-next-line importx/order
import koTasks from '@/modules/i18n/locales/ko/tasks.json';

import zhCommon from '@/modules/i18n/locales/zh-CN/common.json';
import zhSettings from '@/modules/i18n/locales/zh-CN/settings.json';
import zhAuth from '@/modules/i18n/locales/zh-CN/auth.json';
import zhSidebar from '@/modules/i18n/locales/zh-CN/sidebar.json';
import zhChat from '@/modules/i18n/locales/zh-CN/chat.json';
import zhCodeEditor from '@/modules/i18n/locales/zh-CN/codeEditor.json';
import zhTasks from '@/modules/i18n/locales/zh-CN/tasks.json';
import jaCommon from '@/modules/i18n/locales/ja/common.json';
import jaSettings from '@/modules/i18n/locales/ja/settings.json';
import jaAuth from '@/modules/i18n/locales/ja/auth.json';
import jaSidebar from '@/modules/i18n/locales/ja/sidebar.json';
import jaChat from '@/modules/i18n/locales/ja/chat.json';
import jaCodeEditor from '@/modules/i18n/locales/ja/codeEditor.json';
// oxlint-disable-next-line importx/order
import jaTasks from '@/modules/i18n/locales/ja/tasks.json';

import ruCommon from '@/modules/i18n/locales/ru/common.json';
import ruSettings from '@/modules/i18n/locales/ru/settings.json';
import ruAuth from '@/modules/i18n/locales/ru/auth.json';
import ruSidebar from '@/modules/i18n/locales/ru/sidebar.json';
import ruChat from '@/modules/i18n/locales/ru/chat.json';
import ruCodeEditor from '@/modules/i18n/locales/ru/codeEditor.json';
// oxlint-disable-next-line importx/order
import ruTasks from '@/modules/i18n/locales/ru/tasks.json';

import deCommon from '@/modules/i18n/locales/de/common.json';
import deSettings from '@/modules/i18n/locales/de/settings.json';
import deAuth from '@/modules/i18n/locales/de/auth.json';
import deSidebar from '@/modules/i18n/locales/de/sidebar.json';
import deChat from '@/modules/i18n/locales/de/chat.json';
import deCodeEditor from '@/modules/i18n/locales/de/codeEditor.json';
// oxlint-disable-next-line importx/order
import deTasks from '@/modules/i18n/locales/de/tasks.json';

import trCommon from '@/modules/i18n/locales/tr/common.json';
import trSettings from '@/modules/i18n/locales/tr/settings.json';
import trAuth from '@/modules/i18n/locales/tr/auth.json';
import trSidebar from '@/modules/i18n/locales/tr/sidebar.json';
import trChat from '@/modules/i18n/locales/tr/chat.json';
import trCodeEditor from '@/modules/i18n/locales/tr/codeEditor.json';
import trTasks from '@/modules/i18n/locales/tr/tasks.json';
import itCommon from '@/modules/i18n/locales/it/common.json';
import itSettings from '@/modules/i18n/locales/it/settings.json';
import itAuth from '@/modules/i18n/locales/it/auth.json';
import itSidebar from '@/modules/i18n/locales/it/sidebar.json';
import itChat from '@/modules/i18n/locales/it/chat.json';
import itCodeEditor from '@/modules/i18n/locales/it/codeEditor.json';
// oxlint-disable-next-line importx/order
import itTasks from '@/modules/i18n/locales/it/tasks.json';

import zhTWCommon from '@/modules/i18n/locales/zh-TW/common.json';
import zhTWSettings from '@/modules/i18n/locales/zh-TW/settings.json';
import zhTWAuth from '@/modules/i18n/locales/zh-TW/auth.json';
import zhTWSidebar from '@/modules/i18n/locales/zh-TW/sidebar.json';
import zhTWChat from '@/modules/i18n/locales/zh-TW/chat.json';
import zhTWCodeEditor from '@/modules/i18n/locales/zh-TW/codeEditor.json';
// oxlint-disable-next-line importx/order
import zhTWTasks from '@/modules/i18n/locales/zh-TW/tasks.json';

// Import supported languages configuration
import { languages } from '@/modules/i18n/languages';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreference,
} from '@/shared/userSettings';

// The chosen language lives in auth.db so it follows the user between devices.
// It is read synchronously from the preference mirror because i18n has to be
// configured at module load, long before any request could resolve.
const getSavedLanguage = (): string => {
  const saved = readUserPreference<string | null>('userLanguage', null);
  // Validate that the saved language is supported
  if (saved && languages.some(lang => lang.value === saved)) {
    return saved;
  }
  return 'en';
};

// Initialize i18next
i18n
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    // Resources containing all translations
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        auth: enAuth,
        sidebar: enSidebar,
        chat: enChat,
        codeEditor: enCodeEditor,
        tasks: enTasks,
      },
      fr: {
        common: frCommon,
        settings: frSettings,
        auth: frAuth,
        sidebar: frSidebar,
        chat: frChat,
        codeEditor: frCodeEditor,
        tasks: frTasks,
      },
      es: {
        common: esCommon,
        settings: esSettings,
        auth: esAuth,
        sidebar: esSidebar,
        chat: esChat,
        codeEditor: esCodeEditor,
        tasks: esTasks,
      },
      ko: {
        common: koCommon,
        settings: koSettings,
        auth: koAuth,
        sidebar: koSidebar,
        chat: koChat,
        codeEditor: koCodeEditor,
        tasks: koTasks,
      },
      'zh-CN': {
        common: zhCommon,
        settings: zhSettings,
        auth: zhAuth,
        sidebar: zhSidebar,
        chat: zhChat,
        codeEditor: zhCodeEditor,
        tasks: zhTasks,
      },
      ja: {
        common: jaCommon,
        settings: jaSettings,
        auth: jaAuth,
        sidebar: jaSidebar,
        chat: jaChat,
        codeEditor: jaCodeEditor,
        tasks: jaTasks,
      },
      ru: {
        common: ruCommon,
        settings: ruSettings,
        auth: ruAuth,
        sidebar: ruSidebar,
        chat: ruChat,
        codeEditor: ruCodeEditor,
        tasks: ruTasks,
      },
      de: {
        common: deCommon,
        settings: deSettings,
        auth: deAuth,
        sidebar: deSidebar,
        chat: deChat,
        codeEditor: deCodeEditor,
        tasks: deTasks,
      },
      tr: {
        common: trCommon,
        settings: trSettings,
        auth: trAuth,
        sidebar: trSidebar,
        chat: trChat,
        codeEditor: trCodeEditor,
        tasks: trTasks,
      },
      it: {
        common: itCommon,
        settings: itSettings,
        auth: itAuth,
        sidebar: itSidebar,
        chat: itChat,
        codeEditor: itCodeEditor,
        tasks: itTasks,
      },
      'zh-TW': {
        common: zhTWCommon,
        settings: zhTWSettings,
        auth: zhTWAuth,
        sidebar: zhTWSidebar,
        chat: zhTWChat,
        codeEditor: zhTWCodeEditor,
        tasks: zhTWTasks,
      },
    },

    // Default language
    lng: getSavedLanguage(),

    // Fallback language when a translation is missing
    fallbackLng: 'en',

    // Enable debug mode in development (logs missing keys to console)
    debug: false,

    // Namespaces - load only what's needed
    ns: ['common', 'settings', 'auth', 'sidebar', 'chat', 'codeEditor', 'tasks'],
    defaultNS: 'common',

    // Key separator for nested keys (default: '.')
    keySeparator: '.',

    // Namespace separator (default: ':')
    nsSeparator: ':',

    // Save missing translations (disabled - requires manual review)
    saveMissing: false,

    // Interpolation settings
    interpolation: {
      escapeValue: false, // React already escapes values
    },

    // React-specific settings
    react: {
      useSuspense: true, // Use Suspense for lazy-loading
      bindI18n: 'languageChanged', // Re-render on language change
      bindI18nStore: false, // Don't re-render on resource changes
    },
  });

// Save language preference when it changes
i18n.on('languageChanged', (lng: string) => {
  writeUserPreference('userLanguage', lng);
});

// A language chosen on another device arrives with the hydrated preferences,
// after i18n was already initialized with whatever the mirror held.
subscribeToUserPreferences(() => {
  const saved = readUserPreference<string | null>('userLanguage', null);
  if (saved && saved !== i18n.language && languages.some(lang => lang.value === saved)) {
    void i18n.changeLanguage(saved);
  }
});

export default i18n;
