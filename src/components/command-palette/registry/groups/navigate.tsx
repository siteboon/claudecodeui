import type { AppTab } from '../../../../types/app';
import type { GroupConfig } from '../types';

const NAV_TABS: Array<{ id: AppTab; label: string; keywords: string }> = [
  { id: 'chat', label: 'Go to Chat', keywords: 'chat messages conversation' },
  { id: 'files', label: 'Go to Files', keywords: 'files file tree explorer' },
  { id: 'shell', label: 'Go to Shell', keywords: 'shell terminal console' },
  { id: 'git', label: 'Go to Git', keywords: 'git diff branches' },
  { id: 'tasks', label: 'Go to Tasks', keywords: 'tasks taskmaster' },
];

export const navigateGroup: GroupConfig = {
  id: 'navigate',
  heading: 'Navigate',
  modes: ['mixed', 'actions'],
  useItems: (ctx) =>
    NAV_TABS.map((tab) => ({
      key: `nav-${tab.id}`,
      value: `${tab.label} ${tab.keywords}`,
      onSelect: () => ctx.run(() => ctx.onShowTab?.(tab.id)),
      node: <span className="flex-1">{tab.label}</span>,
    })),
};
