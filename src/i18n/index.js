import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translations
import enCommon from './locales/en/common.json';
import enChat from './locales/en/chat.json';
import enGit from './locales/en/git.json';
import enErrors from './locales/en/errors.json';
import enAuth from './locales/en/auth.json';
import enFile from './locales/en/file.json';
import enTerminal from './locales/en/terminal.json';
import enSettings from './locales/en/settings.json';
import enTodo from './locales/en/todo.json';
import enEditor from './locales/en/editor.json';

import zhTWCommon from './locales/zh-TW/common.json';
import zhTWChat from './locales/zh-TW/chat.json';
import zhTWGit from './locales/zh-TW/git.json';
import zhTWErrors from './locales/zh-TW/errors.json';
import zhTWAuth from './locales/zh-TW/auth.json';
import zhTWFile from './locales/zh-TW/file.json';
import zhTWTerminal from './locales/zh-TW/terminal.json';
import zhTWSettings from './locales/zh-TW/settings.json';
import zhTWTodo from './locales/zh-TW/todo.json';
import zhTWEditor from './locales/zh-TW/editor.json';

const resources = {
  en: {
    common: enCommon,
    chat: enChat,
    git: enGit,
    errors: enErrors,
    auth: enAuth,
    file: enFile,
    terminal: enTerminal,
    settings: enSettings,
    todo: enTodo,
    editor: enEditor
  },
  'zh-TW': {
    common: zhTWCommon,
    chat: zhTWChat,
    git: zhTWGit,
    errors: zhTWErrors,
    auth: zhTWAuth,
    file: zhTWFile,
    terminal: zhTWTerminal,
    settings: zhTWSettings,
    todo: zhTWTodo,
    editor: zhTWEditor
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'chat', 'git', 'errors', 'auth', 'file', 'terminal', 'settings', 'todo', 'editor'],
    
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'claude-ui-language'
    },
    
    interpolation: {
      escapeValue: false // React already escapes values
    },
    
    react: {
      useSuspense: false // Avoid suspense for SSR compatibility
    }
  });

export default i18n;