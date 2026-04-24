import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import PaneHeader from '../main-content/view/subcomponents/PaneTabBar';
import type { AppTab } from '../../types/app';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useSessionStatusMap } from '../../hooks/useSessionStatusMap';
import { useArchivedSessions } from '../../hooks/useArchivedSessions';
import { lookupSessionWithProviderStamp } from '../../hooks/useSessionLookup';
import type { ProjectSession, SessionStatus } from '../../types/app';
import type { PaneEntry } from '../main-content/types/types';
import { navigationTarget, parsePaneRoute } from '../../utils/paneRoute';

export default function AppContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { ws, sendMessage, latestMessage, isConnected } = useWebSocket();
  const wasConnectedRef = useRef(false);

  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
  } = useSessionProtection();

  const {
    projects,
    selectedProject,
    selectedSession,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    externalMessageUpdate,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    setShowSettings,
    openSettings,
    refreshProjectsSilently,
    addPendingNewSession,
    sidebarSharedProps,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
  });

  // Per-pane active tab: each pane can be on a different session tab (chat/shell/…).
  const [paneTabMap, setPaneTabMap] = useState<Record<string, AppTab>>({});
  const makeSetTab = useCallback(
    (paneId: string) =>
      (action: AppTab | ((prev: AppTab) => AppTab)) => {
        setPaneTabMap((prev) => {
          const current = prev[paneId] ?? activeTab;
          const next = typeof action === 'function' ? action(current) : action;
          return { ...prev, [paneId]: next };
        });
      },
    [activeTab],
  );

  // ─── Multi-pane derivation ────────────────────────────────────────────────
  // Parse the URL once per location change. URL shape:
  //   /session/<paneIds[0]>?panes=<id1>,<id2>&focus=<N>
  const parsedRoute = useMemo(
    () => parsePaneRoute(sessionId ?? null, location.search),
    [sessionId, location.search],
  );

  const panes = useMemo<PaneEntry[]>(() => {
    return parsedRoute.paneIds.map((paneId) => {
      const match = lookupSessionWithProviderStamp(projects, paneId);
      return {
        paneId,
        session: match?.session ?? null,
        project: match?.project ?? null,
      };
    });
  }, [parsedRoute.paneIds, projects]);

  const focusedPane = panes[parsedRoute.focusIndex] ?? panes[0] ?? null;
  const focusedSession = focusedPane?.session ?? selectedSession;
  const focusedProject = focusedPane?.project ?? selectedProject;

  const handlePaneFocus = useCallback(
    (paneId: string) => {
      const nextIndex = parsedRoute.paneIds.indexOf(paneId);
      if (nextIndex < 0 || nextIndex === parsedRoute.focusIndex) return;
      const target = navigationTarget(parsedRoute, parsedRoute.paneIds, nextIndex);
      navigate(`${target.path}${target.search}`, { replace: target.replace });
    },
    [navigate, parsedRoute],
  );

  const handlePaneClose = useCallback(
    (paneId: string) => {
      const idx = parsedRoute.paneIds.indexOf(paneId);
      if (idx < 0) return;
      const nextPaneIds = parsedRoute.paneIds.filter((_, i) => i !== idx);
      if (nextPaneIds.length === 0) {
        navigate('/');
        return;
      }
      let nextFocus = parsedRoute.focusIndex;
      if (idx === parsedRoute.focusIndex) {
        nextFocus = Math.max(0, idx - 1);
      } else if (idx < parsedRoute.focusIndex) {
        nextFocus = parsedRoute.focusIndex - 1;
      }
      const target = navigationTarget(parsedRoute, nextPaneIds, nextFocus);
      navigate(`${target.path}${target.search}`, { replace: target.replace });
    },
    [navigate, parsedRoute],
  );

  const openPaneFromSidebar = useCallback(
    (targetSessionId: string, openInNewPane = false) => {
      console.log('[pane] openPaneFromSidebar', targetSessionId, 'openInNewPane=', openInNewPane);
      if (!openInNewPane) {
        const nextPaneIds = parsedRoute.paneIds.length === 0
          ? [targetSessionId]
          : parsedRoute.paneIds.map((id, i) => (i === parsedRoute.focusIndex ? targetSessionId : id));
        const target = navigationTarget(parsedRoute, nextPaneIds, parsedRoute.focusIndex);
        navigate(`${target.path}${target.search}`, { replace: target.replace });
        return;
      }
      const alreadyOpenAt = parsedRoute.paneIds.indexOf(targetSessionId);
      if (alreadyOpenAt >= 0) {
        const target = navigationTarget(parsedRoute, parsedRoute.paneIds, alreadyOpenAt);
        navigate(`${target.path}${target.search}`, { replace: target.replace });
        return;
      }
      const nextPaneIds = [...parsedRoute.paneIds, targetSessionId];
      const target = navigationTarget(parsedRoute, nextPaneIds, nextPaneIds.length - 1);
      navigate(`${target.path}${target.search}`, { replace: target.replace });
    },
    [navigate, parsedRoute],
  );

  const handleSidebarSessionSelect = useCallback(
    (session: ProjectSession, opts?: { openInNewPane?: boolean }) => {
      console.log('[sidebar] handleSidebarSessionSelect', session.id, 'openInNewPane=', opts?.openInNewPane ?? false);
      sidebarSharedProps.onSessionSelect(session);
      openPaneFromSidebar(session.id, opts?.openInNewPane ?? false);
    },
    [sidebarSharedProps, openPaneFromSidebar],
  );

  // Pane keyboard shortcuts
  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    const handleKeydown = (e: KeyboardEvent) => {
      // Alt+W — close focused pane
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'w' || e.key === 'W')) {
        if (parsedRoute.paneIds.length > 1 && !isTypingTarget(e.target)) {
          const focused = parsedRoute.paneIds[parsedRoute.focusIndex];
          if (focused) {
            e.preventDefault();
            handlePaneClose(focused);
          }
        }
        return;
      }

      // Ctrl+Shift+1..9 — focus Nth pane
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const idx = parseInt(e.code.slice(5), 10) - 1;
        if (idx < parsedRoute.paneIds.length) {
          e.preventDefault();
          handlePaneFocus(parsedRoute.paneIds[idx]);
        }
      }
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handlePaneClose, handlePaneFocus, parsedRoute]);

  useEffect(() => {
    // Expose a non-blocking refresh for chat/session flows.
    // Full loading refreshes are still available through direct fetchProjects calls.
    window.refreshProjects = refreshProjectsSilently;

    return () => {
      if (window.refreshProjects === refreshProjectsSilently) {
        delete window.refreshProjects;
      }
    };
  }, [refreshProjectsSilently]);

  useEffect(() => {
    window.openSettings = openSettings;

    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || message.type !== 'notification:navigate') {
        return;
      }

      if (typeof message.provider === 'string' && message.provider.trim()) {
        localStorage.setItem('selected-provider', message.provider);
      }

      setActiveTab('chat');
      setSidebarOpen(false);
      void refreshProjectsSilently();

      if (typeof message.sessionId === 'string' && message.sessionId) {
        navigate(`/session/${message.sessionId}`);
        return;
      }

      navigate('/');
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [navigate, refreshProjectsSilently, setActiveTab, setSidebarOpen]);

  // Permission recovery: query pending permissions on WebSocket reconnect or session change.
  // Covers all open panes, not just the focused one.
  useEffect(() => {
    const isReconnect = isConnected && !wasConnectedRef.current;

    if (isReconnect) {
      wasConnectedRef.current = true;
    } else if (!isConnected) {
      wasConnectedRef.current = false;
    }

    if (!isConnected) return;

    const sessionIds = panes.length > 0
      ? panes.map((p) => p.paneId)
      : selectedSession?.id ? [selectedSession.id] : [];

    for (const id of sessionIds) {
      sendMessage({ type: 'get-pending-permissions', sessionId: id });
    }
  }, [isConnected, panes, selectedSession?.id, sendMessage]);

  const statusMap = useSessionStatusMap({ activeSessions, processingSessions });
  const sessionStatus: SessionStatus | undefined = focusedSession
    ? statusMap.get(focusedSession.id)
    : undefined;
  const { isArchived } = useArchivedSessions();

  // "Waiting" count excludes sessions the user can already see in a pane.
  const paneSessionIds = useMemo(
    () => new Set(panes.map((pane) => pane.paneId)),
    [panes],
  );
  const waitingCount = useMemo(() => {
    let count = 0;
    for (const id of processingSessions) {
      if (paneSessionIds.has(id)) continue;
      if (isArchived(id)) continue;
      count++;
    }
    return count;
  }, [processingSessions, paneSessionIds, isArchived]);
  const onJumpToNextWaiting = useCallback(() => {
    for (const id of processingSessions) {
      if (!paneSessionIds.has(id)) {
        openPaneFromSidebar(id, false);
        return;
      }
    }
    const first = processingSessions.values().next().value;
    if (first) openPaneFromSidebar(first, false);
  }, [processingSessions, paneSessionIds, openPaneFromSidebar]);

  // Adjust the app container to stay above the virtual keyboard on iOS Safari.
  // On Chrome for Android the layout viewport already shrinks when the keyboard opens,
  // so inset-0 adjusts automatically. On iOS the layout viewport stays full-height and
  // the keyboard overlays it — we use the Visual Viewport API to track keyboard height
  // and apply it as a CSS variable that shifts the container's bottom edge up.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // Only resize matters — keyboard open/close changes vv.height.
      // Do NOT listen to scroll: on iOS Safari, scrolling content changes
      // vv.offsetTop which would make --keyboard-height fluctuate during
      // normal scrolling, causing the container to bounce up and down.
      const kb = Math.max(0, window.innerHeight - vv.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kb}px`);
    };
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  const [sidebarHover, setSidebarHover] = useState(false);
  const multiPane = !isMobile && panes.length > 1;

  return (
    <div className="fixed inset-0 flex bg-background" style={{ bottom: 'var(--keyboard-height, 0px)' }}>
      {!isMobile ? (
        <div
          className="relative h-full flex-shrink-0"
          style={{ width: multiPane ? '48px' : undefined }}
          onMouseEnter={() => { if (multiPane) setSidebarHover(true); }}
          onMouseLeave={() => setSidebarHover(false)}
        >
          <div
            className={`h-full transition-[transform,box-shadow] duration-250 ease-out ${multiPane ? 'absolute left-0 top-0 z-50' : 'border-r border-border/50'}`}
            style={multiPane ? {
              transform: sidebarHover ? 'translateX(0)' : 'translateX(calc(-100% + 48px))',
              boxShadow: sidebarHover ? '4px 0 24px rgba(0,0,0,0.18)' : 'none',
            } : undefined}
          >
            <Sidebar
              {...sidebarSharedProps}
              onSessionSelect={handleSidebarSessionSelect}
              activeSessions={activeSessions}
              processingSessions={processingSessions}
            />
          </div>
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'visible opacity-100' : 'invisible opacity-0'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative h-full w-[85vw] max-w-sm transform border-r border-border/40 bg-card transition-transform duration-150 ease-out sm:w-80 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar
              {...sidebarSharedProps}
              onSessionSelect={handleSidebarSessionSelect}
              activeSessions={activeSessions}
              processingSessions={processingSessions}
            />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-row">
        {panes.length > 0 ? panes.map((pane, idx) => {
          const paneStatus = pane.session ? statusMap.get(pane.session.id) : undefined;
          const isFocused = idx === parsedRoute.focusIndex;
          return (
            <div key={pane.paneId} className="flex min-w-0 flex-1 flex-col" style={idx > 0 ? { borderLeft: '1px solid var(--border)' } : undefined}>
              {panes.length > 1 && (
                <PaneHeader
                  label={pane.session?.summary || pane.session?.title || pane.session?.id || 'Session not found'}
                  index={idx}
                  isFocused={isFocused}
                  onFocus={() => handlePaneFocus(pane.paneId)}
                  onClose={() => handlePaneClose(pane.paneId)}
                />
              )}
              <MainContent
                selectedProject={pane.project ?? focusedProject}
                selectedSession={pane.session ?? focusedSession}
                activeTab={paneTabMap[pane.paneId] ?? activeTab}
                setActiveTab={makeSetTab(pane.paneId) as typeof setActiveTab}
                ws={ws}
                sendMessage={sendMessage}
                latestMessage={latestMessage}
                isMobile={isMobile}
                onMenuClick={() => setSidebarOpen(true)}
                isLoading={isLoadingProjects}
                onInputFocusChange={setIsInputFocused}
                onSessionActive={markSessionAsActive}
                onSessionInactive={markSessionAsInactive}
                onSessionProcessing={markSessionAsProcessing}
                onSessionNotProcessing={markSessionAsNotProcessing}
                processingSessions={processingSessions}
                onReplaceTemporarySession={replaceTemporarySession}
                onAddPendingNewSession={addPendingNewSession}
                onNavigateToSession={(targetSessionId: string) => openPaneFromSidebar(targetSessionId, false)}
                onShowSettings={() => setShowSettings(true)}
                externalMessageUpdate={externalMessageUpdate}
                sessionStatus={paneStatus}
                waitingCount={isFocused ? waitingCount : 0}
                onJumpToNextWaiting={isFocused ? onJumpToNextWaiting : undefined}
              />
            </div>
          );
        }) : (
          <div className="flex min-w-0 flex-1 flex-col">
            <MainContent
              selectedProject={focusedProject}
              selectedSession={focusedSession}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              ws={ws}
              sendMessage={sendMessage}
              latestMessage={latestMessage}
              isMobile={isMobile}
              onMenuClick={() => setSidebarOpen(true)}
              isLoading={isLoadingProjects}
              onInputFocusChange={setIsInputFocused}
              onSessionActive={markSessionAsActive}
              onSessionInactive={markSessionAsInactive}
              onSessionProcessing={markSessionAsProcessing}
              onSessionNotProcessing={markSessionAsNotProcessing}
              processingSessions={processingSessions}
              onReplaceTemporarySession={replaceTemporarySession}
              onAddPendingNewSession={addPendingNewSession}
              onNavigateToSession={(targetSessionId: string) => openPaneFromSidebar(targetSessionId, false)}
              onShowSettings={() => setShowSettings(true)}
              externalMessageUpdate={externalMessageUpdate}
              sessionStatus={sessionStatus}
              waitingCount={waitingCount}
              onJumpToNextWaiting={onJumpToNextWaiting}
            />
          </div>
        )}
      </div>

    </div>
  );
}
