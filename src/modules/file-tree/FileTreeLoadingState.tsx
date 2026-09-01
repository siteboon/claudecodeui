import { useTranslation } from 'react-i18next';

/** Rendered by FileTree while the first file listing is still loading. */
export default function FileTreeLoadingState() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-sm text-muted-foreground">{t('fileTree.loading')}</div>
    </div>
  );
}

