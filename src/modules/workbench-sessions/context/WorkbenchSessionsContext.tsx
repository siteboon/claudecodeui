import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import type { WorkbenchProposal, WorkbenchSession } from '@/shared/types';
import { getErrorText } from '@/shared/utils';
import {
  INITIAL_POLL_STATE,
  applySessionsError,
  applySessionsSnapshot,
  type SessionsPollState,
} from '@/modules/workbench-sessions/utils/workbenchSessionLogic';
import { countPendingProposals } from '@/modules/workbench-sessions/utils/agentAccessLogic';

const POLL_INTERVAL_MS = 3000;
// Proposals change rarely (an agent has to write one), so they are polled less often than sessions.
const PROPOSALS_POLL_INTERVAL_MS = 10_000;

type WorkbenchSessionsContextValue = {
  sessions: WorkbenchSession[];
  /** True once the first poll has completed (successfully or not). */
  isLoaded: boolean;
  error: string | null;
  selectedSessionId: string | null;
  selectedSession: WorkbenchSession | null;
  selectSession: (sessionId: string | null) => void;
  /** Re-fetches immediately; used after create/commit/merge/discard so the UI does not wait for the next poll. */
  refresh: () => Promise<void>;
  /** Asks for browser notification permission. Must be called from a user gesture (a button click). */
  requestNotificationPermission: () => void;
  /** Agent task proposals waiting for the owner; drives the sidebar badge. */
  pendingProposalCount: number;
  /** Re-reads the pending count right away; called after approving or rejecting. */
  refreshProposals: () => Promise<void>;
  /** Whether the Agent access dialog is open; shared so the sidebar button and the notification event can both open it. */
  isAgentAccessOpen: boolean;
  setAgentAccessOpen: (open: boolean) => void;
};

const WorkbenchSessionsContext = createContext<WorkbenchSessionsContextValue | null>(null);

/** Shows a browser notification; silently does nothing when unsupported or not granted. */
function showStatusNotification(title: string, body: string, tag: string, onClick: () => void) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return;
  }
  try {
    const notification = new Notification(title, { body, tag });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {
    // Some embedded browsers expose Notification but refuse to construct it.
  }
}

/** Mounted by the project-workspace module around the whole workspace so the sidebar section, the session view and the notifications share one poll. */
export function WorkbenchSessionsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('workbench');
  // Latest poll result. Held in state so the sidebar and session view re-render when it changes.
  const [pollState, setPollState] = useState<SessionsPollState>(INITIAL_POLL_STATE);
  // The previous snapshot's statuses live in a ref too: transitions must be computed against the
  // newest value even when two polls resolve before React commits, and a ref avoids stale closures.
  const pollStateRef = useRef<SessionsPollState>(INITIAL_POLL_STATE);
  // True after the first poll finished, so the UI can tell "loading" from "no sessions yet".
  const [isLoaded, setIsLoaded] = useState(false);
  // Which Workbench session fills the main area; null shows the regular project workspace.
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Number of pending agent proposals, for the sidebar badge.
  const [pendingProposalCount, setPendingProposalCount] = useState(0);
  // Whether the Agent access dialog is showing.
  const [isAgentAccessOpen, setAgentAccessOpen] = useState(false);

  const selectSession = useCallback((sessionId: string | null) => {
    setSelectedSessionId(sessionId);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await api.workbench.listSessions();
      const body = await readApiJson<{ data: { sessions: WorkbenchSession[] } }>(response);
      const { state, notify } = applySessionsSnapshot(pollStateRef.current, body.data.sessions);
      pollStateRef.current = state;
      setPollState(state);
      for (const session of notify) {
        showStatusNotification(
          t(`notifications.${session.status === 'waiting' ? 'waitingTitle' : 'doneTitle'}`, { title: session.title }),
          t(`notifications.${session.status === 'waiting' ? 'waitingBody' : 'doneBody'}`, { branch: session.branch }),
          session.id,
          () => setSelectedSessionId(session.id),
        );
      }
    } catch (error) {
      const next = applySessionsError(
        pollStateRef.current,
        getErrorText(error),
      );
      pollStateRef.current = next;
      setPollState(next);
    } finally {
      setIsLoaded(true);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      // Hidden tabs do not need a 3 s heartbeat; the next visibility change catches up.
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    }, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refresh]);

  const refreshProposals = useCallback(async () => {
    try {
      const response = await api.workbench.agentProposals();
      const body = await readApiJson<{ data: { proposals: WorkbenchProposal[] } }>(response);
      setPendingProposalCount(countPendingProposals(body.data.proposals));
    } catch {
      // Keep the last known count; a failed poll must not hide pending proposals or raise errors.
    }
  }, []);

  useEffect(() => {
    void refreshProposals();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshProposals();
    }, PROPOSALS_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshProposals]);

  // The Electron shell fires this when the proposal notification is clicked.
  useEffect(() => {
    const handleOpen = () => setAgentAccessOpen(true);
    window.addEventListener('workbench:open-proposals', handleOpen);
    return () => window.removeEventListener('workbench:open-proposals', handleOpen);
  }, []);

  // The Electron shell fires this when a native notification is clicked; detail is the session id.
  useEffect(() => {
    const handleSelect = (event: Event) => {
      const sessionId = (event as CustomEvent<unknown>).detail;
      if (typeof sessionId === 'string' && sessionId) {
        setSelectedSessionId(sessionId);
      }
    };
    window.addEventListener('workbench:select-session', handleSelect);
    return () => window.removeEventListener('workbench:select-session', handleSelect);
  }, []);

  const requestNotificationPermission = useCallback(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      // A denied or dismissed prompt is fine: notifications just stay off.
      void Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  const selectedSession = useMemo(
    () => pollState.sessions.find((session) => session.id === selectedSessionId) ?? null,
    [pollState.sessions, selectedSessionId],
  );

  const value = useMemo<WorkbenchSessionsContextValue>(
    () => ({
      sessions: pollState.sessions,
      isLoaded,
      error: pollState.error,
      selectedSessionId,
      selectedSession,
      selectSession,
      refresh,
      requestNotificationPermission,
      pendingProposalCount,
      refreshProposals,
      isAgentAccessOpen,
      setAgentAccessOpen,
    }),
    [
      pollState,
      isLoaded,
      selectedSessionId,
      selectedSession,
      selectSession,
      refresh,
      requestNotificationPermission,
      pendingProposalCount,
      refreshProposals,
      isAgentAccessOpen,
    ],
  );

  return <WorkbenchSessionsContext.Provider value={value}>{children}</WorkbenchSessionsContext.Provider>;
}

/** Used by the sidebar section, the session view and project-workspace's selection sync to read and drive the shared Workbench session state. */
export function useWorkbenchSessions(): WorkbenchSessionsContextValue {
  const context = useContext(WorkbenchSessionsContext);
  if (!context) {
    throw new Error('useWorkbenchSessions must be used inside WorkbenchSessionsProvider');
  }
  return context;
}
