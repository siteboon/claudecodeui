import { FileText, History } from 'lucide-react';
import type { GitPanelView } from '../types/types';

type GitViewTabsProps = {
  activeView: GitPanelView;
  isHidden: boolean;
  onChange: (view: GitPanelView) => void;
};

export default function GitViewTabs({ activeView, isHidden, onChange }: GitViewTabsProps) {
  return (
    <div
      className={`flex border-b border-border/60 transition-all duration-300 ease-in-out ${
        isHidden ? 'max-h-0 -translate-y-2 overflow-hidden opacity-0' : 'max-h-16 translate-y-0 opacity-100'
      }`}
    >
      <button
        onClick={() => onChange('changes')}
        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
          activeView === 'changes'
            ? 'border-b-2 border-primary text-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <FileText className="h-4 w-4" />
          <span>Changes</span>
        </span>
      </button>
      <button
        onClick={() => onChange('history')}
        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
          activeView === 'history'
            ? 'border-b-2 border-primary text-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <History className="h-4 w-4" />
          <span>History</span>
        </span>
      </button>
    </div>
  );
}
