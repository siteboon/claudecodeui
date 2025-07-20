// Simplified i18n configuration to avoid import issues during build
const i18n = {
  language: 'en',
  changeLanguage: () => Promise.resolve(),
  use: () => i18n,
  init: () => Promise.resolve(),
  t: (key) => key,
  dir: () => 'ltr'
};

export default i18n;