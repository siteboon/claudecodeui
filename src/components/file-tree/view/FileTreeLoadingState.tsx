import { useTranslation } from 'react-i18next';

export default function FileTreeLoadingState() {
  const { t } = useTranslation();

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-muted-foreground text-sm">{t('fileTree.loading')}</div>
    </div>
  );
}

