import { useTranslation } from 'react-i18next';

export default function FileTreeDetailedColumns() {
  const { t } = useTranslation();

  return (
    <div className="border-b border-border px-3 pb-1 pt-1.5">
      <div className="grid grid-cols-12 gap-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        <div className="col-span-5">{t('fileTree.name')}</div>
        <div className="col-span-2">{t('fileTree.size')}</div>
        <div className="col-span-3">{t('fileTree.modified')}</div>
        <div className="col-span-2">{t('fileTree.permissions')}</div>
      </div>
    </div>
  );
}

