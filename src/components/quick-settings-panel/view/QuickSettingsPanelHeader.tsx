import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function QuickSettingsPanelHeader() {
  const { t } = useTranslation('settings');

  return (
    <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
        <Settings2 className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        {t('quickSettings.title')}
      </h3>
    </div>
  );
}
