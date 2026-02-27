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
  return (
    <div
      className={`border-b border-border/60 flex items-center justify-between transition-all duration-300 ease-in-out ${
        isMobile ? 'px-3 py-1.5' : 'px-4 py-2'
      } ${isHidden ? 'max-h-0 opacity-0 -translate-y-2 overflow-hidden' : 'max-h-16 opacity-100 translate-y-0'}`}
    >
      <span className="text-sm text-muted-foreground">
        {selectedCount} of {totalCount} {isMobile ? '' : 'files'} selected
      </span>
      <span className={`flex ${isMobile ? 'gap-1' : 'gap-2'}`}>
        <button
          onClick={onSelectAll}
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          {isMobile ? 'All' : 'Select All'}
        </button>
        <span className="text-border">|</span>
        <button
          onClick={onDeselectAll}
          className="text-sm text-primary hover:text-primary/80 transition-colors"
        >
          {isMobile ? 'None' : 'Deselect All'}
        </button>
      </span>
    </div>
  );
}
