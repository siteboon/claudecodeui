import { GitCommit } from 'lucide-react';

import { useCommitsSource } from '../../sources/useCommitsSource';
import type { GroupConfig } from '../types';

export const commitsGroup: GroupConfig = {
  id: 'commits',
  heading: 'Commits',
  modes: ['mixed', 'commits'],
  prefix: { char: '#', mode: 'commits' },
  requiresProject: true,
  useItems: (ctx) => {
    const { items: commits } = useCommitsSource(ctx.projectId, ctx.enabled);
    return commits.map((c) => ({
      key: `commit-${c.hash}`,
      value: `${c.shortHash} ${c.message} ${c.author}`,
      onSelect: () => ctx.run(() => ctx.onShowTab?.('git')),
      node: (
        <>
          <GitCommit className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="font-mono text-xs text-muted-foreground">{c.shortHash}</span>
          <span className="flex-1 truncate">{c.message}</span>
          <span className="truncate text-xs text-muted-foreground">{c.author}</span>
        </>
      ),
    }));
  },
};
