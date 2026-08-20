import { useTranslation } from 'react-i18next';

export default function FileTreeLoadingState() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-sm text-muted-foreground">{t('fileTree.loading')}</div>
    </div>
  );
}

