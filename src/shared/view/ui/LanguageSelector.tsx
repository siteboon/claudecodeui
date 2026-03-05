

import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { languages } from '../../../i18n/languages';

type LanguageSelectorProps = {
  compact?: boolean;
};

/**
 * Language Selector Component
 *
 * A dropdown component for selecting the application language.
 * Automatically updates the i18n language and persists to localStorage.
 *
 * Props:
 * @param {boolean} compact - If true, uses compact style (default: false)
 */
export default function LanguageSelector({ compact = false }: LanguageSelectorProps) {
  const { i18n, t } = useTranslation('settings');

  const handleLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = event.target.value;
    i18n.changeLanguage(newLanguage);
  };

  // Compact style for QuickSettingsPanel
  if (compact) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-transparent bg-gray-50 p-3 transition-colors hover:border-gray-300 hover:bg-gray-100 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700">
        <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
          <Languages className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          {t('account.language')}
        </span>
        <select
          value={i18n.language}
          onChange={handleLanguageChange}
          className="w-[100px] rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 dark:focus:ring-blue-400"
        >
          {languages.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.nativeName}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // Full style for Settings page
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/50">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-1 font-medium text-gray-900 dark:text-gray-100">
            {t('account.languageLabel')}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {t('account.languageDescription')}
          </div>
        </div>
        <select
          value={i18n.language}
          onChange={handleLanguageChange}
          className="w-36 rounded-lg border border-gray-300 bg-gray-50 p-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        >
          {languages.map((lang) => (
            <option key={lang.value} value={lang.value}>
              {lang.nativeName}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
