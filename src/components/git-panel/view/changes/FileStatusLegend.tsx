import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { getStatusBadgeClass } from '../../utils/gitPanelUtils';

type FileStatusLegendProps = {
  isMobile: boolean;
};

export default function FileStatusLegend({ isMobile }: FileStatusLegendProps) {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);

  const LEGEND_ITEMS = [
    { status: 'M', label: t('gitPanel.legend.modified') },
    { status: 'A', label: t('gitPanel.legend.added') },
    { status: 'D', label: t('gitPanel.legend.deleted') },
    { status: 'U', label: t('gitPanel.legend.untracked') },
  ] as const;

  if (isMobile) {
    return null;
  }

  return (
    <div className="border-b border-border/60">
      <button
        onClick={() => setIsOpen((previous) => !previous)}
        className="flex w-full items-center justify-center gap-1 bg-muted/30 px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/50"
      >
        <Info className="h-3 w-3" />
        <span>{t('gitPanel.legend.title')}</span>
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {isOpen && (
        <div className="bg-muted/30 px-4 py-3 text-sm">
          <div className="flex justify-center gap-6">
            {LEGEND_ITEMS.map((item) => (
              <span key={item.status} className="flex items-center gap-2">
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold ${getStatusBadgeClass(item.status)}`}
                >
                  {item.status}
                </span>
                <span className="italic text-muted-foreground">{item.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
