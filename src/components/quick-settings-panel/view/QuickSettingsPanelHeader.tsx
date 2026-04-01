import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function QuickSettingsPanelHeader() {
  const { t } = useTranslation('settings');

  return (
    <div className="border-b border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
        <Settings2 className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        {t('quickSettings.title')}
      </h3>
    </div>
  );
}
