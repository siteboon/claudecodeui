import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.json';
import zh from './zh.json';

const resources = {
  en,
  zh
};

const I18nContext = createContext({
  t: (key) => key,
  i18n: {
    language: 'en',
    changeLanguage: () => {}
  }
});

const resolveKeyPath = (key, language) => {
  const parts = key.split('.');
  let value = resources[language];

  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      return undefined;
    }
  }

  return typeof value === 'string' ? value : undefined;
};

export function I18nProvider({ children, defaultLanguage = 'en' }) {
  // Initialize language from localStorage first, to avoid overwriting saved preference
  const [language, setLanguage] = useState(() => {
    const savedLanguage = localStorage.getItem('claudecodeui-language');
    console.log('[i18n] Initializing with saved language:', savedLanguage);
    if (savedLanguage && resources[savedLanguage]) {
      return savedLanguage;
    }
    
    const browserLanguage = navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    console.log('[i18n] No saved language, using browser language:', browserLanguage);
    return resources[browserLanguage] ? browserLanguage : defaultLanguage;
  });

  // Save language to localStorage whenever it changes
  useEffect(() => {
    console.log('[i18n] Saving language to localStorage:', language);
    localStorage.setItem('claudecodeui-language', language);
  }, [language]);

  const t = useCallback(
    (key, options = {}) => {
      const { defaultValue } = options;
      const translated = resolveKeyPath(key, language) ?? resolveKeyPath(key, 'en');
      return translated ?? defaultValue ?? key;
    },
    [language]
  );

  const value = useMemo(() => ({
    t,
    i18n: {
      language,
      changeLanguage: setLanguage
    }
  }), [t, language]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  const context = useContext(I18nContext);
  return {
    translate: context.t,
    t: context.t,
    i18n: context.i18n
  };
}

export { resources };
