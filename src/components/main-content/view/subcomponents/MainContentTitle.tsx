import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import SessionProviderLogo from '../../../llm-logo-provider/SessionProviderLogo';
import { api } from '../../../../utils/api';
import type { AppTab, LLMProvider, Project, ProjectSession, SessionStatus } from '../../../../types/app';
import { usePlugins } from '../../../../contexts/PluginsContext';
import { getSessionTitle } from './getSessionTitle';

type MainContentTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  sessionStatus?: SessionStatus;
};

function getTabTitle(activeTab: AppTab, shouldShowTasksTab: boolean, t: (key: string) => string, pluginDisplayName?: string) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  return 'Project';
}

function StatusDot({ status }: { status: SessionStatus }) {
  const colorClass = {
    running: 'bg-status-running',
    waiting: 'bg-status-waiting',
    error: 'bg-status-error',
    idle: 'bg-status-idle',
    done: 'bg-status-done',
  }[status];

  const shouldPulse = status === 'running' || status === 'waiting';

  return (
    <span className="relative inline-flex h-2 w-2 flex-shrink-0">
      <span className={`h-2 w-2 rounded-full ${colorClass}`} />
      {shouldPulse && (
        <span className={`absolute inset-0 animate-status-pulse rounded-full ${colorClass}`} />
      )}
    </span>
  );
}

const MAX_RENAME_LENGTH = 500;

type InlineSessionTitleProps = {
  session: ProjectSession;
  projectDisplayName: string;
};

function InlineSessionTitle({ session, projectDisplayName }: InlineSessionTitleProps) {
  const displayTitle = getSessionTitle(session);
  // Pending synthetic rows don't have a real session id yet — the user can't
  // rename what the server hasn't minted. Fall back to read-only rendering.
  const isPending = Boolean(session.__pending);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(displayTitle);
  const [hasError, setHasError] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the draft/error state whenever we switch to a different session
  // so the inline-rename input doesn't leak across sessions.
  useEffect(() => {
    setIsEditing(false);
    setDraft(displayTitle);
    setHasError(false);
    setIsSaving(false);
  }, [session.id, displayTitle]);

  useEffect(() => {
    if (!isEditing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isEditing]);

  const beginEdit = useCallback(() => {
    if (isPending || isSaving) return;
    setDraft(displayTitle);
    setHasError(false);
    setIsEditing(true);
  }, [displayTitle, isPending, isSaving]);

  const cancelEdit = useCallback(() => {
    setIsEditing(false);
    setHasError(false);
    setDraft(displayTitle);
  }, [displayTitle]);

  const commitEdit = useCallback(async () => {
    const trimmed = draft.trim();
    // Empty or unchanged — treat as cancel, no API call.
    if (!trimmed || trimmed === displayTitle) {
      cancelEdit();
      return;
    }
    if (trimmed.length > MAX_RENAME_LENGTH) {
      setHasError(true);
      return;
    }

    const provider = (session.__provider || 'claude') as LLMProvider;
    setIsSaving(true);
    setHasError(false);
    try {
      const response = await api.renameSession(session.id, trimmed, provider);
      if (!response.ok) {
        throw new Error(`Rename failed: ${response.status}`);
      }
      setIsEditing(false);
      // Pull the fresh `customName` down so the sidebar + title both reflect
      // the new value without waiting for the next WS broadcast.
      if (typeof window !== 'undefined' && window.refreshProjects) {
        void window.refreshProjects();
      }
    } catch (error) {
      console.error('[MainContentTitle] rename failed:', error);
      // Revert the visible name and surface an inline error beat so the user
      // knows the change didn't stick. No alert(); the sidebar uses alert
      // but that feels heavy for an in-header interaction.
      setHasError(true);
      setDraft(displayTitle);
    } finally {
      setIsSaving(false);
    }
  }, [cancelEdit, displayTitle, draft, session.__provider, session.id]);

  if (isEditing) {
    return (
      <div className="min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          disabled={isSaving}
          maxLength={MAX_RENAME_LENGTH + 1}
          onChange={(event) => {
            setDraft(event.target.value);
            if (hasError) setHasError(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              void commitEdit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelEdit();
            }
          }}
          onBlur={() => {
            if (isSaving) return;
            void commitEdit();
          }}
          className={`w-full rounded border bg-background px-1.5 py-0.5 text-sm font-semibold leading-tight text-foreground focus:outline-none focus:ring-1 ${
            hasError
              ? 'border-red-500/60 focus:ring-red-500/40'
              : 'border-border focus:ring-primary/40'
          }`}
          aria-label="Rename session"
          aria-invalid={hasError || undefined}
        />
        <div className={`truncate text-[11px] leading-tight ${hasError ? 'text-red-500' : 'text-muted-foreground'}`}>
          {hasError ? 'Rename failed — try again' : `@${projectDisplayName}`}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <h2
        className={`scrollbar-hide overflow-x-auto whitespace-nowrap text-sm font-semibold leading-tight text-foreground ${
          isPending ? 'cursor-default' : 'cursor-text'
        }`}
        onDoubleClick={beginEdit}
        title={isPending ? undefined : 'Double-click to rename'}
      >
        {displayTitle}
      </h2>
      <div className="truncate text-[11px] leading-tight text-muted-foreground">
        @{projectDisplayName}
      </div>
    </div>
  );
}

export default function MainContentTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  sessionStatus,
}: MainContentTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionView = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionView && sessionStatus ? (
        <StatusDot status={sessionStatus} />
      ) : showSessionView ? (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <SessionProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <InlineSessionTitle
            session={selectedSession}
            projectDisplayName={selectedProject.displayName}
          />
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="truncate text-xs leading-tight text-muted-foreground">@{selectedProject.displayName}</div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, t, pluginDisplayName)}
            </h2>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">@{selectedProject.displayName}</div>
          </div>
        )}
      </div>
    </div>
  );
}
