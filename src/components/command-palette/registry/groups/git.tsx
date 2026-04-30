import { ArrowDownToLine, ArrowUpFromLine, GitMerge, RefreshCw } from 'lucide-react';

import { useBranchesSource } from '../../sources/useBranchesSource';
import { useGitActions } from '../../sources/useGitActions';
import type { GroupConfig, PaletteItem } from '../types';

export const gitGroup: GroupConfig = {
  id: 'git',
  heading: 'Git',
  modes: ['mixed', 'actions'],
  requiresProject: true,
  useItems: (ctx) => {
    const git = useGitActions(ctx.projectId);
    const { items: branches } = useBranchesSource(ctx.projectId, ctx.enabled);

    const items: PaletteItem[] = [
      {
        key: 'git-fetch',
        value: 'Git Fetch remote',
        onSelect: () => ctx.run(() => { void git.fetch(); ctx.onShowTab?.('git'); }),
        node: (
          <>
            <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">Git: Fetch</span>
          </>
        ),
      },
      {
        key: 'git-pull',
        value: 'Git Pull merge upstream',
        onSelect: () => ctx.run(() => { void git.pull(); ctx.onShowTab?.('git'); }),
        node: (
          <>
            <ArrowDownToLine className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">Git: Pull</span>
          </>
        ),
      },
      {
        key: 'git-push',
        value: 'Git Push origin remote',
        onSelect: () => ctx.run(() => { void git.push(); ctx.onShowTab?.('git'); }),
        node: (
          <>
            <ArrowUpFromLine className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1">Git: Push</span>
          </>
        ),
      },
    ];

    for (const b of branches.filter((br) => !br.isCurrent && !br.isRemote).slice(0, 30)) {
      items.push({
        key: `git-branch-${b.name}`,
        value: `Switch to branch ${b.name}`,
        onSelect: () => ctx.run(() => { void git.checkout(b.name); ctx.onShowTab?.('git'); }),
        node: (
          <>
            <GitMerge className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1 truncate">Switch to branch: {b.name}</span>
          </>
        ),
      });
    }
    return items;
  },
};
