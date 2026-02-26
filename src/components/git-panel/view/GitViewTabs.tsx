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
        isHidden ? 'max-h-0 opacity-0 -translate-y-2 overflow-hidden' : 'max-h-16 opacity-100 translate-y-0'
      }`}
    >
      <button
        onClick={() => onChange('changes')}
        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
          activeView === 'changes'
            ? 'text-primary border-b-2 border-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <FileText className="w-4 h-4" />
          <span>Changes</span>
        </span>
      </button>
      <button
        onClick={() => onChange('history')}
        className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
          activeView === 'history'
            ? 'text-primary border-b-2 border-primary'
            : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <span className="flex items-center justify-center gap-2">
          <History className="w-4 h-4" />
          <span>History</span>
        </span>
      </button>
    </div>
  );
}
