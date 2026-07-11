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
// eslint-disable-next-line import-x/order
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation resources
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enAuth from './locales/en/auth.json';
import enSidebar from './locales/en/sidebar.json';
import enChat from './locales/en/chat.json';
import enCodeEditor from './locales/en/codeEditor.json';
// eslint-disable-next-line import-x/order
import enTasks from './locales/en/tasks.json';
import enPrd from './locales/en/prd.json';

import koCommon from './locales/ko/common.json';
import koSettings from './locales/ko/settings.json';
import koAuth from './locales/ko/auth.json';
import koSidebar from './locales/ko/sidebar.json';
import koChat from './locales/ko/chat.json';
// eslint-disable-next-line import-x/order
import koCodeEditor from './locales/ko/codeEditor.json';
// eslint-disable-next-line import-x/order
import koTasks from './locales/ko/tasks.json';
import koPrd from './locales/ko/prd.json';

import zhCommon from './locales/zh-CN/common.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhAuth from './locales/zh-CN/auth.json';
import zhSidebar from './locales/zh-CN/sidebar.json';
import zhChat from './locales/zh-CN/chat.json';
// eslint-disable-next-line import-x/order
import zhCodeEditor from './locales/zh-CN/codeEditor.json';
// eslint-disable-next-line import-x/order
import zhTasks from './locales/zh-CN/tasks.json';
import zhPrd from './locales/zh-CN/prd.json';

import jaCommon from './locales/ja/common.json';
import jaSettings from './locales/ja/settings.json';
import jaAuth from './locales/ja/auth.json';
import jaSidebar from './locales/ja/sidebar.json';
import jaChat from './locales/ja/chat.json';
import jaCodeEditor from './locales/ja/codeEditor.json';
// eslint-disable-next-line import-x/order
import jaTasks from './locales/ja/tasks.json';
import jaPrd from './locales/ja/prd.json';

import ruCommon from './locales/ru/common.json';
import ruSettings from './locales/ru/settings.json';
import ruAuth from './locales/ru/auth.json';
import ruSidebar from './locales/ru/sidebar.json';
import ruChat from './locales/ru/chat.json';
import ruCodeEditor from './locales/ru/codeEditor.json';
// eslint-disable-next-line import-x/order
import ruTasks from './locales/ru/tasks.json';
import ruPrd from './locales/ru/prd.json';

import deCommon from './locales/de/common.json';
import deSettings from './locales/de/settings.json';
import deAuth from './locales/de/auth.json';
import deSidebar from './locales/de/sidebar.json';
import deChat from './locales/de/chat.json';
import deCodeEditor from './locales/de/codeEditor.json';
// eslint-disable-next-line import-x/order
import deTasks from './locales/de/tasks.json';
import dePrd from './locales/de/prd.json';

import trCommon from './locales/tr/common.json';
import trSettings from './locales/tr/settings.json';
import trAuth from './locales/tr/auth.json';
import trSidebar from './locales/tr/sidebar.json';
import trChat from './locales/tr/chat.json';
import trCodeEditor from './locales/tr/codeEditor.json';
// eslint-disable-next-line import-x/order
import trTasks from './locales/tr/tasks.json';
import trPrd from './locales/tr/prd.json';
import itCommon from './locales/it/common.json';
import itSettings from './locales/it/settings.json';
import itAuth from './locales/it/auth.json';
import itSidebar from './locales/it/sidebar.json';
import itChat from './locales/it/chat.json';
import itCodeEditor from './locales/it/codeEditor.json';
// eslint-disable-next-line import-x/order
import itTasks from './locales/it/tasks.json';
import itPrd from './locales/it/prd.json';

import zhTWCommon from './locales/zh-TW/common.json';
import zhTWSettings from './locales/zh-TW/settings.json';
import zhTWAuth from './locales/zh-TW/auth.json';
import zhTWSidebar from './locales/zh-TW/sidebar.json';
import zhTWChat from './locales/zh-TW/chat.json';
import zhTWCodeEditor from './locales/zh-TW/codeEditor.json';
// eslint-disable-next-line import-x/order
import zhTWTasks from './locales/zh-TW/tasks.json';
import zhTWPrd from './locales/zh-TW/prd.json';

// Import supported languages configuration
import { languages } from './languages.js';

// Get saved language preference from localStorage
const getSavedLanguage = () => {
  try {
    const saved = localStorage.getItem('userLanguage');
    // Validate that the saved language is supported
    if (saved && languages.some(lang => lang.value === saved)) {
      return saved;
    }
    return 'en';
  } catch {
    return 'en';
  }
};

// Initialize i18next
i18n
  .use(LanguageDetector) // Detect user language
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
        prd: enPrd,
      },
      ko: {
        common: koCommon,
        settings: koSettings,
        auth: koAuth,
        sidebar: koSidebar,
        chat: koChat,
        codeEditor: koCodeEditor,
        tasks: koTasks,
        prd: koPrd,
      },
      'zh-CN': {
        common: zhCommon,
        settings: zhSettings,
        auth: zhAuth,
        sidebar: zhSidebar,
        chat: zhChat,
        codeEditor: zhCodeEditor,
        tasks: zhTasks,
        prd: zhPrd,
      },
      ja: {
        common: jaCommon,
        settings: jaSettings,
        auth: jaAuth,
        sidebar: jaSidebar,
        chat: jaChat,
        codeEditor: jaCodeEditor,
        tasks: jaTasks,
        prd: jaPrd,
      },
      ru: {
        common: ruCommon,
        settings: ruSettings,
        auth: ruAuth,
        sidebar: ruSidebar,
        chat: ruChat,
        codeEditor: ruCodeEditor,
        tasks: ruTasks,
        prd: ruPrd,
      },
      de: {
        common: deCommon,
        settings: deSettings,
        auth: deAuth,
        sidebar: deSidebar,
        chat: deChat,
        codeEditor: deCodeEditor,
        tasks: deTasks,
        prd: dePrd,
      },
      tr: {
        common: trCommon,
        settings: trSettings,
        auth: trAuth,
        sidebar: trSidebar,
        chat: trChat,
        codeEditor: trCodeEditor,
        tasks: trTasks,
        prd: trPrd,
      },
      it: {
        common: itCommon,
        settings: itSettings,
        auth: itAuth,
        sidebar: itSidebar,
        chat: itChat,
        codeEditor: itCodeEditor,
        tasks: itTasks,
        prd: itPrd,
      },
      'zh-TW': {
        common: zhTWCommon,
        settings: zhTWSettings,
        auth: zhTWAuth,
        sidebar: zhTWSidebar,
        chat: zhTWChat,
        codeEditor: zhTWCodeEditor,
        tasks: zhTWTasks,
        prd: zhTWPrd,
      },
    },

    // Default language
    lng: getSavedLanguage(),

    // Fallback language when a translation is missing
    fallbackLng: 'en',

    // Enable debug mode in development (logs missing keys to console)
    debug: false,

    // Namespaces - load only what's needed
    ns: ['common', 'settings', 'auth', 'sidebar', 'chat', 'codeEditor', 'tasks', 'prd'],
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

    // Detection options
    detection: {
      // Order of language detection (local storage first)
      order: ['localStorage'],

      // Keys to look for in localStorage
      lookupLocalStorage: 'userLanguage',

      // Cache user language
      caches: ['localStorage'],
    },
  });

// Save language preference when it changes
i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('userLanguage', lng);
  } catch (error) {
    console.error('Failed to save language preference:', error);
  }
});

export default i18n;
