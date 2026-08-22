import { FileText, GitBranch, GitFork, History } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { GitPanelView } from '../types/types';

type GitViewTabsProps = {
  activeView: GitPanelView;
  isHidden: boolean;
  changeCount: number;
  onChange: (view: GitPanelView) => void;
};

const TABS: { id: GitPanelView; labelKey: string; Icon: typeof FileText }[] = [
  { id: 'changes', labelKey: 'git:tabs.changes', Icon: FileText },
  { id: 'history', labelKey: 'git:tabs.history', Icon: History },
  { id: 'branches', labelKey: 'git:tabs.branches', Icon: GitBranch },
  { id: 'worktrees', labelKey: 'git:tabs.worktrees', Icon: GitFork },
];

export default function GitViewTabs({ activeView, isHidden, changeCount, onChange }: GitViewTabsProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`border-b border-border/60 transition-all duration-300 ease-in-out ${
        isHidden ? 'max-h-0 -translate-y-2 overflow-hidden opacity-0' : 'max-h-16 translate-y-0 opacity-100'
      }`}
    >
      <div
        className="scrollbar-hide flex w-full snap-x overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
        role="tablist"
        aria-label={t('git:tabs.ariaLabel')}
      >
        {TABS.map(({ id, labelKey, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeView === id}
            onClick={() => onChange(id)}
            className={`min-w-max flex-none snap-start px-4 py-2 text-sm font-medium transition-colors sm:min-w-0 sm:flex-1 ${
              activeView === id
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <Icon className="h-4 w-4" />
              <span>{t(labelKey)}</span>
              {id === 'changes' && changeCount > 0 && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary">
                  {changeCount}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
