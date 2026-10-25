import { useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WorkbenchDiffFile, WorkbenchSessionDiff } from '@/shared/types';

type FileEntryProps = {
  file: WorkbenchDiffFile;
  scope: string;
};

function lineClassName(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300';
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-red-500/10 text-red-800 dark:text-red-300';
  if (line.startsWith('@@')) return 'text-sky-700 dark:text-sky-300';
  return 'text-muted-foreground';
}

function FileEntry({ file, scope }: FileEntryProps) {
  // Per-file collapse: large diffs are only readable when the user opens one file at a time.
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-md border border-border/60">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        aria-expanded={isOpen}
        aria-controls={`${scope}-${file.path}`}
        className="flex min-h-11 w-full min-w-0 items-center gap-1.5 px-2 py-1.5 text-left text-xs hover:bg-accent/50 md:min-h-0"
      >
        {isOpen ? <ChevronDown className="h-3 w-3 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
        <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>{file.path}</span>
        <span className="flex-shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">+{file.additions}</span>
        <span className="flex-shrink-0 tabular-nums text-red-600 dark:text-red-400">-{file.deletions}</span>
      </button>
      {isOpen && (
        <pre
          id={`${scope}-${file.path}`}
          className="max-h-96 overflow-auto border-t border-border/60 py-1 text-[11px] leading-4"
        >
          {file.patch.split('\n').map((line, index) => (
            <div key={index} className={`whitespace-pre px-2 ${lineClassName(line)}`}>{line || ' '}</div>
          ))}
        </pre>
      )}
    </div>
  );
}

type DiffGroupProps = {
  title: string;
  files: WorkbenchDiffFile[];
  scope: string;
};

function DiffGroup({ title, files, scope }: DiffGroupProps) {
  if (files.length === 0) return null;
  return (
    <div className="space-y-1">
      <h4 className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title} <span className="tabular-nums">({files.length})</span>
      </h4>
      {files.map((file) => <FileEntry key={`${scope}-${file.path}`} file={file} scope={scope} />)}
    </div>
  );
}

type WorkbenchDiffPanelProps = {
  diff: WorkbenchSessionDiff | null;
  isLoading: boolean;
  error: string | null;
  onReload: () => void;
};

/** Rendered by WorkbenchSessionView beside the terminal: the session's committed, uncommitted and untracked changes with per-file collapse. */
export default function WorkbenchDiffPanel({ diff, isLoading, error, onReload }: WorkbenchDiffPanelProps) {
  const { t } = useTranslation('workbench');
  const isEmpty = diff !== null
    && diff.committed.length === 0
    && diff.uncommitted.length === 0
    && diff.untracked.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <h3 className="text-xs font-medium text-foreground">
          {t('diff.title')}
          {diff && <span className="ml-1 font-normal text-muted-foreground">{diff.baseBranch}...{diff.branch}</span>}
        </h3>
        <button
          type="button"
          onClick={onReload}
          className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-6 md:w-6"
          aria-label={t('diff.reload')}
          title={t('diff.reload')}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {isLoading && <p className="text-xs text-muted-foreground">{t('diff.loading')}</p>}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {isEmpty && <p className="text-xs text-muted-foreground">{t('diff.empty')}</p>}
        {diff && (
          <>
            <DiffGroup title={t('diff.uncommitted')} files={diff.uncommitted} scope="uncommitted" />
            {diff.untracked.length > 0 && (
              <div className="space-y-1">
                <h4 className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('diff.untracked')} <span className="tabular-nums">({diff.untracked.length})</span>
                </h4>
                <ul className="rounded-md border border-border/60 py-1">
                  {diff.untracked.map((path) => (
                    <li key={path} className="truncate px-2 py-0.5 font-mono text-xs" title={path}>{path}</li>
                  ))}
                </ul>
              </div>
            )}
            <DiffGroup title={t('diff.committed')} files={diff.committed} scope="committed" />
          </>
        )}
      </div>
    </div>
  );
}
