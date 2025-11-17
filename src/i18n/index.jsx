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
  const [language, setLanguage] = useState(defaultLanguage);

  useEffect(() => {
    const savedLanguage = localStorage.getItem('claudecodeui-language');
    if (savedLanguage && resources[savedLanguage]) {
      setLanguage(savedLanguage);
      return;
    }

    const browserLanguage = navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    if (resources[browserLanguage]) {
      setLanguage(browserLanguage);
    }
  }, []);

  useEffect(() => {
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
    t: context.t,
    i18n: context.i18n
  };
}

export { resources };
