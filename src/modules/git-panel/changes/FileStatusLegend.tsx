import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getStatusBadgeClass } from '@/modules/git-panel/utils/gitPanelUtils';

type FileStatusLegendProps = {
  isMobile: boolean;
};

const LEGEND_ITEMS = [
  { status: 'M', label: 'git:status.modified' },
  { status: 'A', label: 'git:status.added' },
  { status: 'D', label: 'git:status.deleted' },
  { status: 'U', label: 'git:status.untracked' },
] as const;

/** Rendered by ChangesView to explain the M/A/D/U status badges used in the change list. */
export default function FileStatusLegend({ isMobile }: FileStatusLegendProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

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
        <span>{t('git:legend.title')}</span>
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
                <span className="italic text-muted-foreground">{t(item.label)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
