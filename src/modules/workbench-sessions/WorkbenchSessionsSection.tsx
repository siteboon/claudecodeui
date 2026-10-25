import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronDown, ChevronRight, GitBranch, Plus, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import type { Project, WorkbenchHooksStatus, WorkbenchSession } from '@/shared/types';
import { LLMProviderLogo } from '@/shared/ui';
import { useWorkbenchSessions } from '@/modules/workbench-sessions/context/WorkbenchSessionsContext';
import AgentAccessDialog from '@/modules/workbench-sessions/modals/AgentAccessDialog';
import HooksConsentDialog from '@/modules/workbench-sessions/modals/HooksConsentDialog';
import NewSessionDialog from '@/modules/workbench-sessions/modals/NewSessionDialog';
import { formatPendingBadge } from '@/modules/workbench-sessions/utils/agentAccessLogic';
import {
  formatCompactAge,
  getStatusBadge,
  groupSessionsByProject,
  shouldOfferHooksConsent,
} from '@/modules/workbench-sessions/utils/workbenchSessionLogic';

const HOOKS_DECLINED_KEY = 'workbench.hooksConsent';
const AGE_TICK_MS = 30_000;

function readHooksDeclined(): boolean {
  try {
    return window.localStorage.getItem(HOOKS_DECLINED_KEY) === 'declined';
  } catch {
    return false;
  }
}

function writeHooksDeclined() {
  try {
    window.localStorage.setItem(HOOKS_DECLINED_KEY, 'declined');
  } catch {
    // Storage can be unavailable (private windows); the prompt may then repeat, which is acceptable.
  }
}

type SessionRowProps = {
  session: WorkbenchSession;
  now: number;
  isSelected: boolean;
  onSelect: (sessionId: string) => void;
};

function SessionRow({ session, now, isSelected, onSelect }: SessionRowProps) {
  const { t } = useTranslation('workbench');
  const badge = getStatusBadge(session.status);
  const age = formatCompactAge(session.lastActivityAt, now);

  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      aria-current={isSelected ? 'true' : undefined}
      className={`flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-accent/60 ${
        isSelected ? 'bg-accent' : ''
      }`}
    >
      <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-muted/60">
        <LLMProviderLogo provider={session.agent} className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-4 text-foreground">{session.title}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-muted-foreground">
          <GitBranch className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{session.branch}</span>
          {age && (
            <>
              <span className="flex-shrink-0 text-muted-foreground/40">·</span>
              <time className="flex-shrink-0 tabular-nums" dateTime={session.lastActivityAt}>
                {age}
              </time>
            </>
          )}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${badge.className}`}>
            <span className={`h-1.5 w-1.5 rounded-full bg-current ${badge.pulse ? 'animate-pulse' : ''}`} />
            {t(badge.labelKey)}
          </span>
          {session.unpushed > 0 && (
            <span
              className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-700 dark:text-violet-300"
              title={t('unpushedTooltip', { count: session.unpushed })}
            >
              {t('unpushed', { count: session.unpushed })}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

type WorkbenchSessionsSectionProps = {
  /** The app's known projects, offered in the New Session dialog's project picker. */
  projects: Project[];
};

/** Rendered by the sidebar module above its project list: Workbench worktree sessions grouped by project, plus the New Session entry point. */
export default function WorkbenchSessionsSection({ projects }: WorkbenchSessionsSectionProps) {
  const { t } = useTranslation('workbench');
  const {
    sessions,
    isLoaded,
    error,
    selectedSessionId,
    selectSession,
    refresh,
    requestNotificationPermission,
    pendingProposalCount,
    setAgentAccessOpen,
  } = useWorkbenchSessions();
  const pendingBadge = formatPendingBadge(pendingProposalCount);
  // Section collapse state: the list can get long, and users working elsewhere want it out of the way.
  const [isExpanded, setIsExpanded] = useState(true);
  // Whether the New Session dialog is showing.
  const [isNewSessionOpen, setIsNewSessionOpen] = useState(false);
  // Whether the one-time hooks consent dialog is showing.
  const [isHooksConsentOpen, setIsHooksConsentOpen] = useState(false);
  // Wall clock for the relative ages; ticks so "5m" stays roughly current without re-polling.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const groups = useMemo(() => groupSessionsByProject(sessions), [sessions]);

  const handleCreated = (session: WorkbenchSession) => {
    selectSession(session.id);
    void refresh();
    // Ask for hook consent once, after the first session exists, unless the user already said no.
    if (readHooksDeclined()) return;
    void (async () => {
      try {
        const status = await readApiJson<{ data: WorkbenchHooksStatus }>(await api.workbench.hooksStatus());
        if (shouldOfferHooksConsent(status.data, false)) setIsHooksConsentOpen(true);
      } catch {
        // Status hooks are optional: output-idle detection still works without them.
      }
    })();
  };

  return (
    <section className="border-b border-border/50 px-2 py-2" aria-label={t('section.title')}>
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={isExpanded}
          className="flex min-h-11 items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground md:min-h-0"
        >
          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {t('section.title')}
          {sessions.length > 0 && <span className="tabular-nums text-muted-foreground/70">{sessions.length}</span>}
        </button>
        <div className="flex items-center">
        <button
          type="button"
          onClick={() => setAgentAccessOpen(true)}
          className="relative flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-6 md:w-6"
          aria-label={pendingProposalCount > 0 ? t('section.agentAccessPending', { count: pendingProposalCount }) : t('section.agentAccess')}
          title={t('section.agentAccess')}
        >
          <Bot className="h-3.5 w-3.5" />
          {pendingBadge && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground md:-right-1 md:-top-1">
              {pendingBadge}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setIsHooksConsentOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-6 md:w-6"
          aria-label={t('section.hooksSettings')}
          title={t('section.hooksSettings')}
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setIsNewSessionOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:h-6 md:w-6"
          aria-label={t('section.newSession')}
          title={t('section.newSession')}
        >
          <Plus className="h-4 w-4" />
        </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-1 space-y-2">
          {error && !isLoaded && <p className="px-2 text-xs text-destructive">{error}</p>}
          {isLoaded && sessions.length === 0 && !error && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t('section.empty')}</p>
          )}
          {error && isLoaded && (
            <p className="px-2 text-[10px] text-destructive" role="status">{t('section.pollFailed')}</p>
          )}
          {groups.map((group) => (
            <div key={group.projectPath}>
              <p className="truncate px-2 pb-0.5 text-[11px] font-normal text-muted-foreground" title={group.projectPath}>
                {group.projectName}
              </p>
              {group.sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  now={now}
                  isSelected={session.id === selectedSessionId}
                  onSelect={selectSession}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {isNewSessionOpen && (
        <NewSessionDialog
          open={isNewSessionOpen}
          onOpenChange={setIsNewSessionOpen}
          projects={projects}
          onCreated={handleCreated}
          onSubmitGesture={requestNotificationPermission}
        />
      )}
      <HooksConsentDialog
        open={isHooksConsentOpen}
        onOpenChange={setIsHooksConsentOpen}
        onDeclined={writeHooksDeclined}
      />
      <AgentAccessDialog />
    </section>
  );
}
