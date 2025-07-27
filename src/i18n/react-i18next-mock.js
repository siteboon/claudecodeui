// Mock for react-i18next during build
import React from 'react';

export const useTranslation = (namespaces) => {
  return {
    t: (key, options) => {
      if (options && Object.keys(options).length) {
        let result = key;
        Object.entries(options).forEach(([k, v]) => {
          result = result.replace(`{{${k}}}`, v);
        });
        return result;
      }
      return key;
    },
    i18n: {
      language: 'en',
      changeLanguage: () => Promise.resolve(),
      dir: () => 'ltr'
    }
  };
};

export const initReactI18next = {
  type: '3rdParty',
  init: () => {}
};

export const Trans = ({ children }) => children;