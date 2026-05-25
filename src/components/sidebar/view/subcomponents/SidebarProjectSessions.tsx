import { useState } from 'react';
import { Check, GitBranch, Loader2, Plus, X } from 'lucide-react';
import type { TFunction } from 'i18next';

import { Button } from '../../../../shared/view/ui';
import type { Project, ProjectSession, LLMProvider, Worktree } from '../../../../types/app';
import type { SessionWithProvider } from '../../types/types';
import { getAllSessions } from '../../utils/utils';

import SidebarSessionItem from './SidebarSessionItem';
import SidebarWorktreeItem from './SidebarWorktreeItem';

type WorktreeMutationResult =
  | { ok: true }
  | { ok: false; error: { code: string; message: string } };

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  hasMoreSessions: boolean;
  isLoadingMoreSessions: boolean;
  currentTime: Date;
  editingSession: string | null;
  editingSessionName: string;
  expandedWorktrees: Set<string>;
  selectedWorktreePath: string | null;
  onToggleWorktree: (worktreePath: string) => void;
  onWorktreeSelect: (project: Project, worktree: Worktree) => void;
  onWorktreeNewSession: (project: Project, worktree: Worktree) => void;
  onCreateWorktree: (projectId: string, name: string) => Promise<WorktreeMutationResult>;
  onRemoveWorktree: (projectId: string, worktreePath: string, force?: boolean) => Promise<WorktreeMutationResult>;
  onOpenSessionInWorktree: (session: SessionWithProvider, project: Project, worktree: Worktree) => void;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: LLMProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: LLMProvider,
  ) => void;
  onLoadMoreSessions: (projectId: string) => void;
  onNewSession: (project: Project) => void;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-md p-2">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 h-3 w-3 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-1">
              <div className="h-3 animate-pulse rounded bg-muted" style={{ width: `${60 + index * 15}%` }} />
              <div className="h-2 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

type NewWorktreeFormProps = {
  projectId: string;
  onCreateWorktree: (projectId: string, name: string) => Promise<WorktreeMutationResult>;
};

function NewWorktreeForm({ projectId, onCreateWorktree }: NewWorktreeFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const close = () => {
    setIsOpen(false);
    setName('');
    setError(null);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required.');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await onCreateWorktree(projectId, trimmed);
      if (result.ok) {
        close();
      } else {
        setError(result.error.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Unexpected error: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-full justify-start gap-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        onClick={() => setIsOpen(true)}
      >
        <GitBranch className="h-3 w-3" />
        New worktree
      </Button>
    );
  }

  return (
    <div className="space-y-1.5 rounded-md border border-border/60 bg-card p-2">
      <div className="flex items-center gap-1.5">
        <GitBranch className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="worktree-name"
          className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
          autoFocus
          disabled={isSubmitting}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              void submit();
            }
            if (event.key === 'Escape') {
              close();
            }
          }}
        />
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-green-600 transition-colors hover:bg-green-50 disabled:opacity-50 dark:hover:bg-green-900/20"
          onClick={(event) => {
            event.stopPropagation();
            void submit();
          }}
          disabled={isSubmitting}
          title="Create"
        >
          {isSubmitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
          onClick={(event) => {
            event.stopPropagation();
            close();
          }}
          disabled={isSubmitting}
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && (
        <p className="px-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

export default function SidebarProjectSessions({
  project,
  isExpanded,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  hasMoreSessions,
  isLoadingMoreSessions,
  currentTime,
  editingSession,
  editingSessionName,
  expandedWorktrees,
  selectedWorktreePath,
  onToggleWorktree,
  onWorktreeSelect,
  onWorktreeNewSession,
  onCreateWorktree,
  onRemoveWorktree,
  onOpenSessionInWorktree,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  t,
}: SidebarProjectSessionsProps) {
  if (!isExpanded) {
    return null;
  }

  const worktrees = project.worktrees ?? [];
  const isGitProject = worktrees.length >= 1;
  const showWorktreeLayer = worktrees.length > 1;

  if (showWorktreeLayer) {
    return (
      <div className="ml-3 space-y-1 border-l border-border pl-3">
        <NewWorktreeForm projectId={project.projectId} onCreateWorktree={onCreateWorktree} />
        {worktrees.map((worktree) => (
          <SidebarWorktreeItem
            key={worktree.path}
            project={project}
            worktree={worktree}
            sessions={getAllSessions({
              ...project,
              sessions: worktree.sessions,
              cursorSessions: worktree.cursorSessions,
              codexSessions: worktree.codexSessions,
              geminiSessions: worktree.geminiSessions,
            })}
            isExpanded={expandedWorktrees.has(worktree.path)}
            isSelected={selectedWorktreePath === worktree.path}
            selectedSession={selectedSession}
            currentTime={currentTime}
            editingSession={editingSession}
            editingSessionName={editingSessionName}
            onToggleWorktree={onToggleWorktree}
            onWorktreeSelect={onWorktreeSelect}
            onWorktreeNewSession={onWorktreeNewSession}
            onRemoveWorktree={onRemoveWorktree}
            allWorktrees={worktrees}
            onOpenSessionInWorktree={onOpenSessionInWorktree}
            onSessionSelect={onSessionSelect}
            onDeleteSession={onDeleteSession}
            onEditingSessionNameChange={onEditingSessionNameChange}
            onStartEditingSession={onStartEditingSession}
            onCancelEditingSession={onCancelEditingSession}
            onSaveEditingSession={onSaveEditingSession}
            t={t}
          />
        ))}
      </div>
    );
  }

  const hasSessions = sessions.length > 0;

  return (
    <div className="ml-3 space-y-1 border-l border-border pl-3">
      <div className="px-3 pb-1 pt-1 md:hidden">
        <button
          className="flex h-8 w-full items-center justify-center gap-2 rounded-md bg-primary text-xs font-medium text-primary-foreground transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"
          onClick={() => {
            onProjectSelect(project);
            onNewSession(project);
          }}
        >
          <Plus className="h-3 w-3" />
          {t('sessions.newSession')}
        </button>
      </div>

      <Button
        variant="default"
        size="sm"
        className="hidden h-8 w-full justify-start gap-2 bg-primary text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 md:flex"
        onClick={() => onNewSession(project)}
      >
        <Plus className="h-3 w-3" />
        {t('sessions.newSession')}
      </Button>

      {isGitProject && (
        <NewWorktreeForm projectId={project.projectId} onCreateWorktree={onCreateWorktree} />
      )}

      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions ? (
        <div className="px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        <>
          {sessions.map((session) => (
            <SidebarSessionItem
              key={session.id}
              project={project}
              session={session}
              selectedSession={selectedSession}
              currentTime={currentTime}
              editingSession={editingSession}
              editingSessionName={editingSessionName}
              onEditingSessionNameChange={onEditingSessionNameChange}
              onStartEditingSession={onStartEditingSession}
              onCancelEditingSession={onCancelEditingSession}
              onSaveEditingSession={onSaveEditingSession}
              onProjectSelect={onProjectSelect}
              onSessionSelect={onSessionSelect}
              onDeleteSession={onDeleteSession}
              worktreesForOpenIn={worktrees}
              onOpenSessionInWorktree={onOpenSessionInWorktree}
              t={t}
            />
          ))}

          {hasMoreSessions && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-center text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onLoadMoreSessions(project.projectId)}
              disabled={isLoadingMoreSessions}
            >
              {isLoadingMoreSessions ? t('sessions.loadingSessions') : 'Load more sessions'}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
