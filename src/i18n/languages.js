/**
 * Supported Languages Configuration
 *
 * This file contains the list of supported languages for the application.
 * Each language includes:
 * - value: Language code (e.g., 'en', 'zh-CN')
 * - label: Display name in English
 * - nativeName: Native language name for display
 */

export const languages = [
  {
    value: 'en',
    label: 'English',
    nativeName: 'English',
  },
  {
    value: 'fr',
    label: 'French',
    nativeName: 'Français',
  },
  {
    value: 'es-ES',
    label: 'Spanish (Spain)',
    nativeName: 'Español (España)',
  },
  {
    value: 'es-419',
    label: 'Spanish (Latin America)',
    nativeName: 'Español (Latinoamérica)',
  },
  {
    value: 'ko',
    label: 'Korean',
    nativeName: '한국어',
  },
  {
    value: 'zh-CN',
    label: 'Simplified Chinese',
    nativeName: '简体中文',
  },
  {
    value: 'zh-TW',
    label: 'Traditional Chinese',
    nativeName: '繁體中文',
  },
  {
    value: 'ja',
    label: 'Japanese',
    nativeName: '日本語',
  },
  {
    value: 'ru',
    label: 'Russian',
    nativeName: 'Русский',
  },
  {
    value: 'de',
    label: 'German',
    nativeName: 'Deutsch',
  },
  {
    value: 'tr',
    label: 'Turkish',
    nativeName: 'Türkçe',
  },
  {
    value: 'it',
    label: 'Italian',
    nativeName: 'Italiano',
  },
];

/**
 * Get language object by value
 * @param {string} value - Language code
 * @returns {Object|undefined} Language object or undefined if not found
 */
export const getLanguage = (value) => {
  return languages.find(lang => lang.value === value);
};

/**
 * Get all language values
 * @returns {string[]} Array of language codes
 */
export const getLanguageValues = () => {
  return languages.map(lang => lang.value);
};

/**
 * Check if a language is supported
 * @param {string} value - Language code to check
 * @returns {boolean} True if language is supported
 */
export const isLanguageSupported = (value) => {
  return languages.some(lang => lang.value === value);
};
