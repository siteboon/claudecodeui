import { FileText } from 'lucide-react';

import { useFilesSource } from '../../sources/useFilesSource';
import type { GroupConfig } from '../types';

export const filesGroup: GroupConfig = {
  id: 'files',
  heading: 'Files',
  modes: ['mixed', 'files'],
  prefix: { char: '/', mode: 'files' },
  requiresProject: true,
  useItems: (ctx) => {
    const { items: files } = useFilesSource(ctx.projectId, ctx.enabled);
    return files.map((f) => ({
      key: `file-${f.path}`,
      value: f.path,
      onSelect: () => ctx.run(() => ctx.openFile(f.path)),
      node: (
        <>
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 truncate">{f.name}</span>
          <span className="truncate text-xs text-muted-foreground">{f.path}</span>
        </>
      ),
    }));
  },
};
