import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Cross-cutting visibility into per-session protection state. Exists so deeply
 * nested components like WorktreeList can light up activity dots without
 * threading props through SidebarProjectItem (which is a no-edit churn file
 * per docs/CLAUDE.md). The provider lives near the root in AppContent and is
 * fed by the same `useSessionProtection` sets that drive ChatInterface.
 */
export type SessionActivityValue = {
  activeSessions: Set<string>;
  processingSessions: Set<string>;
  blockedSessions: Set<string>;
  /**
   * Optional map of worktree absolute path → sessionId currently running
   * inside it. WorktreeList uses this to colour each worktree's dot. When
   * unknown, callers should leave it empty and the dot will resolve to
   * `idle`.
   */
  worktreeSessionMap: Record<string, string>;
};

const EMPTY_SET = new Set<string>();
const DEFAULT_VALUE: SessionActivityValue = {
  activeSessions: EMPTY_SET,
  processingSessions: EMPTY_SET,
  blockedSessions: EMPTY_SET,
  worktreeSessionMap: {},
};

const SessionActivityContext = createContext<SessionActivityValue>(DEFAULT_VALUE);

type ProviderProps = {
  activeSessions?: Set<string>;
  processingSessions?: Set<string>;
  blockedSessions?: Set<string>;
  worktreeSessionMap?: Record<string, string>;
  children: ReactNode;
};

export function SessionActivityProvider({
  activeSessions,
  processingSessions,
  blockedSessions,
  worktreeSessionMap,
  children,
}: ProviderProps) {
  const value = useMemo<SessionActivityValue>(
    () => ({
      activeSessions: activeSessions ?? EMPTY_SET,
      processingSessions: processingSessions ?? EMPTY_SET,
      blockedSessions: blockedSessions ?? EMPTY_SET,
      worktreeSessionMap: worktreeSessionMap ?? {},
    }),
    [activeSessions, processingSessions, blockedSessions, worktreeSessionMap],
  );

  return (
    <SessionActivityContext.Provider value={value}>
      {children}
    </SessionActivityContext.Provider>
  );
}

export function useSessionActivity(): SessionActivityValue {
  return useContext(SessionActivityContext);
}
