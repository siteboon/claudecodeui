import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
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

  // Ctrl+Shift+W closes focused pane (only when >1 pane open)
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.shiftKey && !e.altKey && (e.key === 'w' || e.key === 'W')) {
        if (parsedRoute.paneIds.length > 1) {
          const isTypingTarget = (target: EventTarget | null): boolean => {
            if (!(target instanceof HTMLElement)) return false;
            const tag = target.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
          };
          if (!isTypingTarget(e.target)) {
            const focused = parsedRoute.paneIds[parsedRoute.focusIndex];
            if (focused) {
              e.preventDefault();
              handlePaneClose(focused);
            }
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [handlePaneClose, parsedRoute]);

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

  return (
    <div className="fixed inset-0 flex bg-background" style={{ bottom: 'var(--keyboard-height, 0px)' }}>
      {!isMobile ? (
        <div className="h-full flex-shrink-0 border-r border-border/50">
          <Sidebar
            {...sidebarSharedProps}
            onSessionSelect={handleSidebarSessionSelect}
            activeSessions={activeSessions}
            processingSessions={processingSessions}
          />
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
          panes={panes}
          focusedPaneIndex={parsedRoute.focusIndex}
          onPaneFocus={handlePaneFocus}
          onPaneClose={handlePaneClose}
        />
      </div>

    </div>
  );
}
