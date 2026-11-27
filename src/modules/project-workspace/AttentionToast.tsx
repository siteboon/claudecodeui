import { useCallback, useMemo } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MessageCircleQuestion, X } from 'lucide-react';

import {
  useProjectMainState,
  useProjectSidebarState,
} from '@/modules/project-workspace/context/ProjectsStateContext';
import {
  useAwaitingInputSessionIdSet,
  useDismissAttentionNotice,
  useLatestAttentionNotice,
} from '@/shared/context/PermissionAttentionContext';

/**
 * Rendered by WorkspaceMain and WorkspaceStateView inside the workspace body
 * container below the header so it never overlaps navigation tabs on narrow screens.
 *
 * The sidebar marker alone is easy to miss — it sits on a row that may be
 * scrolled out of view, in a section the user is not browsing, or inside a
 * closed mobile drawer. A run stopped on a question is blocked until someone
 * answers, so the newest off-screen request also gets a card with a direct way
 * into the conversation. While that session is open on screen the card hides;
 * if the user leaves without answering, it reminds again until the prompt is
 * answered or explicitly dismissed.
 */
export default function AttentionToast() {
  const { t } = useTranslation('sidebar');
  const navigate = useNavigate();
  const sessionMatch = useMatch('/session/:sessionId');
  // React Router already decodes route params; decoding again would break `%` ids.
  const viewedSessionId = sessionMatch?.params.sessionId ?? null;
  const notice = useLatestAttentionNotice(viewedSessionId);
  const awaitingInputSessionIds = useAwaitingInputSessionIdSet();
  const dismissNotice = useDismissAttentionNotice();
  const { setSidebarOpen, sidebarSharedProps } = useProjectSidebarState();
  const { setActiveTab } = useProjectMainState();

  // Resolved from the loaded session rows (the only titles the client has);
  // an unloaded session falls back to the generic wording.
  const sessionTitle = useMemo(() => {
    if (!notice) {
      return null;
    }

    for (const project of sidebarSharedProps.projects) {
      const session = project.sessions?.find((candidate) => candidate.id === notice.sessionId);
      if (session) {
        return session.summary || session.name || null;
      }
    }

    return null;
  }, [notice, sidebarSharedProps.projects]);

  const openSession = useCallback(() => {
    if (!notice) {
      return;
    }
    setSidebarOpen(false);
    setActiveTab('chat');
    navigate(`/session/${encodeURIComponent(notice.sessionId)}`);
  }, [navigate, notice, setActiveTab, setSidebarOpen]);

  if (!notice || !awaitingInputSessionIds.has(notice.sessionId)) {
    return null;
  }

  const otherWaitingCount = Math.max(0, awaitingInputSessionIds.size - 1);
  const dismissLabel = t('attention.dismiss', { defaultValue: 'Dismiss' });

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-40 flex justify-end md:inset-x-5">
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex w-full max-w-[22rem] items-start gap-3 rounded-xl border border-amber-300/80 bg-card p-3 text-card-foreground shadow-xl dark:border-amber-500/40"
      >
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
          <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {t('attention.title', { defaultValue: 'Your answer is needed' })}
          </p>
          <p className="mt-0.5 line-clamp-2 break-words text-xs leading-snug text-muted-foreground">
            {sessionTitle
              ? t('attention.bodyNamed', {
                session: sessionTitle,
                defaultValue: '“{{session}}” is waiting for your answer.',
              })
              : t('attention.body', { defaultValue: 'A session is waiting for your answer.' })}
          </p>
          {otherWaitingCount > 0 && (
            <p className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
              {t('attention.more', {
                count: otherWaitingCount,
                defaultValue: '+{{count}} more waiting',
              })}
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={openSession}
              className="inline-flex min-h-9 items-center justify-center rounded-md bg-amber-700 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-800 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
            >
              {t('attention.open', { defaultValue: 'Open' })}
            </button>
          </div>
        </div>

        <button
          type="button"
          aria-label={dismissLabel}
          onClick={() => dismissNotice(notice.requestId, viewedSessionId)}
          className="-mr-1 -mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
