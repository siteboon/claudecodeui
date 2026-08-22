import { useTranslation } from 'react-i18next';

type FileSelectionControlsProps = {
  isMobile: boolean;
  selectedCount: number;
  totalCount: number;
  isHidden: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
};

export default function FileSelectionControls({
  isMobile,
  selectedCount,
  totalCount,
  isHidden,
  onSelectAll,
  onDeselectAll,
}: FileSelectionControlsProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`flex items-center justify-between border-b border-border/60 transition-all duration-300 ease-in-out ${
        isMobile ? 'px-3 py-1.5' : 'px-4 py-2'
      } ${isHidden ? 'max-h-0 -translate-y-2 overflow-hidden opacity-0' : 'max-h-16 translate-y-0 opacity-100'}`}
    >
      <span className="text-sm text-muted-foreground">
        {isMobile
          ? t('git:selection.selectedOf', { selected: selectedCount, total: totalCount })
          : t('git:selection.selectedOfFiles', { selected: selectedCount, count: totalCount })}
      </span>
      <span className={`flex ${isMobile ? 'gap-1' : 'gap-2'}`}>
        <button
          onClick={onSelectAll}
          className="text-sm text-primary transition-colors hover:text-primary/80"
        >
          {isMobile ? t('git:selection.all') : t('git:selection.selectAll')}
        </button>
        <span className="text-border">|</span>
        <button
          onClick={onDeselectAll}
          className="text-sm text-primary transition-colors hover:text-primary/80"
        >
          {isMobile ? t('git:selection.none') : t('git:selection.deselectAll')}
        </button>
      </span>
    </div>
  );
}
