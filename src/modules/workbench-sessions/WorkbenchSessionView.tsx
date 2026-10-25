import { useMemo, useState } from 'react';
import { Copy, GitBranch, GitCommit, GitMerge, RefreshCcw, Trash2, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import { StandaloneShell } from '@/modules/standalone-shell';
import type { Project, WorkbenchDiscardPreview, WorkbenchSession } from '@/shared/types';
import { getErrorText } from '@/shared/utils';
import { Button, Input, LLMProviderLogo } from '@/shared/ui';
import WorkbenchDiffPanel from '@/modules/workbench-sessions/WorkbenchDiffPanel';
import { useWorkbenchSessions } from '@/modules/workbench-sessions/context/WorkbenchSessionsContext';
import { useWorkbenchSessionDiff } from '@/modules/workbench-sessions/hooks/useWorkbenchSessionDiff';
import ConfirmActionDialog from '@/modules/workbench-sessions/modals/ConfirmActionDialog';
import { getStatusBadge } from '@/modules/workbench-sessions/utils/workbenchSessionLogic';

type Banner = { kind: 'success' | 'error'; text: string } | null;
type PendingAction = 'merge' | 'discard' | null;

type WorkbenchSessionViewProps = {
  session: WorkbenchSession;
};

/** Rendered by WorkbenchMainSwitch in place of the project workspace while a Workbench session is selected: terminal, diff panel and the git action bar. */
export default function WorkbenchSessionView({ session }: WorkbenchSessionViewProps) {
  const { t } = useTranslation('workbench');
  const { refresh, selectSession } = useWorkbenchSessions();
  // Reload the diff when the polled facts change (agent edited files or committed).
  const changeKey = `${session.dirtyFiles}:${session.ahead}:${session.status}`;
  const { diff, isLoading, error: diffError, reload } = useWorkbenchSessionDiff(session.id, changeKey);

  // Commit message being typed in the action bar.
  const [commitMessage, setCommitMessage] = useState('');
  // Name of the action currently running; disables the bar so two git operations never overlap.
  const [busyAction, setBusyAction] = useState<string | null>(null);
  // Result of the last action, shown above the terminal until the next action.
  const [banner, setBanner] = useState<Banner>(null);
  // Which confirmation dialog is open, if any.
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  // Optional squash-merge commit message, edited inside the merge dialog.
  const [mergeMessage, setMergeMessage] = useState('');
  // What discarding would delete; fetched when the discard dialog opens.
  const [discardPreview, setDiscardPreview] = useState<WorkbenchDiscardPreview | null>(null);
  // Error from the confirm action itself, shown inside its dialog.
  const [dialogError, setDialogError] = useState<string | null>(null);

  const badge = getStatusBadge(session.status);
  // The terminal only needs a label-bearing project object; the server picks cwd/command/env from the session id.
  const terminalProject = useMemo<Project>(
    () => ({ projectId: session.id, displayName: session.title, fullPath: session.worktreePath }),
    [session.id, session.title, session.worktreePath],
  );

  const runAction = async (name: string, action: () => Promise<string>) => {
    setBusyAction(name);
    setBanner(null);
    try {
      const text = await action();
      setBanner({ kind: 'success', text });
    } catch (actionError) {
      setBanner({ kind: 'error', text: getErrorText(actionError) });
    } finally {
      setBusyAction(null);
      void refresh();
      reload();
    }
  };

  const handleCommit = () =>
    runAction('commit', async () => {
      const body = await readApiJson<{ data: { commit: string } }>(await api.workbench.commit(session.id, commitMessage));
      setCommitMessage('');
      return t('actions.committed', { commit: body.data.commit });
    });

  const handleRebase = () =>
    runAction('rebase', async () => {
      await readApiJson(await api.workbench.rebase(session.id));
      return t('actions.rebased', { base: session.baseBranch });
    });

  const handlePush = () =>
    runAction('push', async () => {
      await readApiJson(await api.workbench.push(session.id));
      return t('actions.pushed', { branch: session.branch });
    });

  const handleCopyPath = () =>
    runAction('copy', async () => {
      await navigator.clipboard.writeText(session.worktreePath);
      return t('actions.pathCopied');
    });

  const openDiscardDialog = async () => {
    setDialogError(null);
    setDiscardPreview(null);
    setPendingAction('discard');
    try {
      const body = await readApiJson<{ data: WorkbenchDiscardPreview }>(await api.workbench.discardPreview(session.id));
      setDiscardPreview(body.data);
    } catch (previewError) {
      setDialogError(getErrorText(previewError));
    }
  };

  const confirmPending = async () => {
    setBusyAction(pendingAction);
    setDialogError(null);
    try {
      if (pendingAction === 'merge') {
        const body = await readApiJson<{ data: { mergedBranch: string; targetBranch: string } }>(
          await api.workbench.merge(session.id, mergeMessage.trim() || undefined),
        );
        setBanner({
          kind: 'success',
          text: t('actions.merged', { branch: body.data.mergedBranch, target: body.data.targetBranch }),
        });
        setPendingAction(null);
      } else if (pendingAction === 'discard') {
        await readApiJson(await api.workbench.discard(session.id));
        setPendingAction(null);
        selectSession(null);
      }
    } catch (confirmError) {
      setDialogError(getErrorText(confirmError));
    } finally {
      setBusyAction(null);
      void refresh();
      reload();
    }
  };

  const isBusy = busyAction !== null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-4 py-2">
        <LLMProviderLogo provider={session.agent} className="h-4 w-4 flex-shrink-0" />
        <h2 className="min-w-0 truncate text-sm font-medium text-foreground" title={session.title}>{session.title}</h2>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <GitBranch className="h-3 w-3" />
          {session.branch}
          <span className="text-muted-foreground/60">→ {session.baseBranch}</span>
        </span>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${badge.className}`}>
          <span className={`h-1.5 w-1.5 rounded-full bg-current ${badge.pulse ? 'animate-pulse' : ''}`} />
          {t(badge.labelKey)}
        </span>
        {session.unpushed > 0 && (
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-700 dark:text-violet-300">
            {t('unpushed', { count: session.unpushed })}
          </span>
        )}
        {!session.worktreeExists && (
          <span className="text-xs text-destructive">{t('actions.worktreeMissing')}</span>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2">
        <Input
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && commitMessage.trim() && !isBusy) void handleCommit();
          }}
          placeholder={t('actions.commitPlaceholder')}
          aria-label={t('actions.commitPlaceholder')}
          className="h-8 min-w-48 max-w-sm flex-1"
          disabled={isBusy}
        />
        <Button size="sm" variant="outline" disabled={isBusy || !commitMessage.trim()} onClick={() => void handleCommit()}>
          <GitCommit /> {t('actions.commit')}
        </Button>
        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void handleRebase()}>
          <RefreshCcw /> {t('actions.rebase')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isBusy}
          onClick={() => {
            setDialogError(null);
            setPendingAction('merge');
          }}
        >
          <GitMerge /> {t('actions.merge')}
        </Button>
        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void handlePush()}>
          <Upload /> {t('actions.push')}
        </Button>
        <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => void handleCopyPath()} title={t('actions.copyPath')}>
          <Copy /> {t('actions.copyPath')}
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive" disabled={isBusy} onClick={() => void openDiscardDialog()}>
          <Trash2 /> {t('actions.discard')}
        </Button>
      </div>

      {banner && (
        <p
          role={banner.kind === 'error' ? 'alert' : 'status'}
          className={`border-b px-4 py-1.5 text-xs ${
            banner.kind === 'error'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          {banner.text}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] md:grid-rows-1">
        <div className="min-h-0 min-w-0 overflow-hidden border-b border-border/60 md:border-b-0 md:border-r">
          {session.worktreeExists ? (
            <StandaloneShell
              key={session.id}
              project={terminalProject}
              workbenchSessionId={session.id}
              showHeader={false}
              isActive
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{t('actions.worktreeMissing')}</p>
          )}
        </div>
        <div className="min-h-0 min-w-0">
          <WorkbenchDiffPanel diff={diff} isLoading={isLoading} error={diffError} onReload={reload} />
        </div>
      </div>

      <ConfirmActionDialog
        open={pendingAction === 'merge'}
        onOpenChange={(open) => !open && !isBusy && setPendingAction(null)}
        title={t('merge.title')}
        confirmLabel={t('merge.confirm')}
        isBusy={busyAction === 'merge'}
        error={pendingAction === 'merge' ? dialogError : null}
        onConfirm={() => void confirmPending()}
      >
        <p>{t('merge.body', { branch: session.branch, base: session.baseBranch })}</p>
        <p className="text-xs">{t('merge.requirements')}</p>
        <Input
          value={mergeMessage}
          onChange={(event) => setMergeMessage(event.target.value)}
          placeholder={t('merge.messagePlaceholder')}
          aria-label={t('merge.messagePlaceholder')}
        />
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={pendingAction === 'discard'}
        onOpenChange={(open) => !open && !isBusy && setPendingAction(null)}
        title={t('discard.title')}
        confirmLabel={t('discard.confirm')}
        destructive
        isBusy={busyAction === 'discard'}
        error={pendingAction === 'discard' ? dialogError : null}
        onConfirm={() => void confirmPending()}
      >
        <p>{t('discard.body')}</p>
        {discardPreview ? (
          <ul className="list-disc space-y-1 pl-5 text-xs text-foreground">
            <li>{t('discard.worktree', { path: discardPreview.worktreePath })}</li>
            <li>{t('discard.branch', { branch: discardPreview.branch })}</li>
            <li>{t('discard.dirty', { count: discardPreview.dirtyFiles })}</li>
            <li>{t('discard.commits', { count: discardPreview.unmergedCommits })}</li>
          </ul>
        ) : (
          !dialogError && <p className="text-xs">{t('discard.loading')}</p>
        )}
      </ConfirmActionDialog>
    </div>
  );
}
