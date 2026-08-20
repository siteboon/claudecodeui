import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function QuickSettingsPanelHeader() {
  const { t } = useTranslation('settings');

  return (
    <div className="border-b border-border bg-muted/40 p-4">
      <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <Settings2 className="h-5 w-5 text-muted-foreground" />
        {t('quickSettings.title')}
      </h3>
    </div>
  );
}
