import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useState } from 'react';
import { getStatusBadgeClass } from '../../utils/gitPanelUtils';

type FileStatusLegendProps = {
  isMobile: boolean;
};

const LEGEND_ITEMS = [
  { status: 'M', label: 'Modified' },
  { status: 'A', label: 'Added' },
  { status: 'D', label: 'Deleted' },
  { status: 'U', label: 'Untracked' },
] as const;

export default function FileStatusLegend({ isMobile }: FileStatusLegendProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (isMobile) {
    return null;
  }

  return (
    <div className="border-b border-border/60">
      <button
        onClick={() => setIsOpen((previous) => !previous)}
        className="w-full px-4 py-2 bg-muted/30 hover:bg-muted/50 text-sm text-muted-foreground flex items-center justify-center gap-1 transition-colors"
      >
        <Info className="w-3 h-3" />
        <span>File Status Guide</span>
        {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {isOpen && (
        <div className="px-4 py-3 bg-muted/30 text-sm">
          <div className="flex justify-center gap-6">
            {LEGEND_ITEMS.map((item) => (
              <span key={item.status} className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center justify-center w-5 h-5 rounded border font-bold text-[10px] ${getStatusBadgeClass(item.status)}`}
                >
                  {item.status}
                </span>
                <span className="text-muted-foreground italic">{item.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
