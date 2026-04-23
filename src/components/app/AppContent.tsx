import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import MainContent from '../main-content/view/MainContent';
import DesktopRail from '../layout/DesktopRail';
import MobileTabBar from '../layout/MobileTabBar';
import MobileSidebarSheet from '../layout/MobileSidebarSheet';
import type { AppNavSlot } from '../layout/useAppNavItems';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { SessionActivityProvider } from '../../contexts/SessionActivityContext';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';

export default function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  // `isMobile` drives the mobile tab bar + bottom-sheet sidebar. At lg+ the
  // persistent rail + in-column sidebar render regardless, so the existing
  // 768-consumers keep their threshold and only layout-level code uses 1024.
  const { isMobile } = useDeviceSettings({ mobileBreakpoint: 1024, trackPWA: false });
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
    sidebarSharedProps,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
  });

  useEffect(() => {
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

  useEffect(() => {
    const isReconnect = isConnected && !wasConnectedRef.current;

    if (isReconnect) {
      wasConnectedRef.current = true;
    } else if (!isConnected) {
      wasConnectedRef.current = false;
    }

    if (isConnected && selectedSession?.id) {
      sendMessage({
        type: 'get-pending-permissions',
        sessionId: selectedSession.id
      });
    }
  }, [isConnected, selectedSession?.id, sendMessage]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height);
      document.documentElement.style.setProperty('--keyboard-height', `${kb}px`);
    };
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  // Best-effort worktree → sessionId map for live activity dots in
  // WorktreeList. We can confidently attribute the *currently selected*
  // session to its project's fullPath; cross-worktree resolution requires a
  // future server endpoint that returns the active session per worktree
  // (tracked in docs/follow-ups.md).
  const worktreeSessionMap = useMemo(() => {
    const map: Record<string, string> = {};
    const path = selectedProject?.fullPath;
    const id = selectedSession?.id;
    if (path && id && selectedProject?.isWorktree) {
      map[path] = id;
    }
    return map;
  }, [selectedProject?.fullPath, selectedProject?.isWorktree, selectedSession?.id]);

  const handleNavSelect = useCallback((slot: AppNavSlot) => {
    switch (slot) {
      case 'chat':
        setSidebarOpen(false);
        setActiveTab('chat');
        break;
      case 'sessions':
        // Mobile: open bottom sheet. Desktop: sidebar is already persistent —
        // toggling ensures the rail tap feels responsive.
        setSidebarOpen((prev) => (isMobile ? !prev : prev));
        break;
      case 'preview':
        setSidebarOpen(false);
        setActiveTab('preview');
        break;
      case 'browser':
        setSidebarOpen(false);
        setActiveTab('browser');
        break;
      case 'more':
        setSidebarOpen(false);
        openSettings();
        break;
    }
  }, [isMobile, openSettings, setActiveTab, setSidebarOpen]);

  return (
    <SessionActivityProvider
      activeSessions={activeSessions}
      processingSessions={processingSessions}
      worktreeSessionMap={worktreeSessionMap}
    >
    <div
      className="fixed inset-0 flex bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      <DesktopRail
        activeTab={activeTab}
        sidebarOpen={sidebarOpen}
        onSelect={handleNavSelect}
      />

      {!isMobile && (
        <aside
          data-accent="lavender"
          className="h-full w-[340px] shrink-0 overflow-hidden border-r border-midnight-border"
          style={{ background: 'var(--midnight-surface-1)' }}
        >
          <Sidebar {...sidebarSharedProps} />
        </aside>
      )}

      {isMobile && (
        <MobileSidebarSheet
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          ariaLabel={t('versionUpdate.ariaLabels.closeSidebar') || 'Sessions'}
        >
          <Sidebar {...sidebarSharedProps} />
        </MobileSidebarSheet>
      )}

      <div
        data-accent={
          activeTab === 'preview'
            ? 'mint'
            : activeTab === 'browser'
              ? 'peach'
              : activeTab === 'tasks'
                ? 'butter'
                : 'sky'
        }
        className="flex min-w-0 flex-1 flex-col"
        style={{ paddingBottom: 'var(--mobile-nav-total, 0px)' }}
      >
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
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
          onNavigateToSession={(targetSessionId: string) => navigate(`/session/${targetSessionId}`)}
          onShowSettings={() => setShowSettings(true)}
          externalMessageUpdate={externalMessageUpdate}
        />
      </div>

      <MobileTabBar
        activeTab={activeTab}
        sidebarOpen={sidebarOpen}
        onSelect={handleNavSelect}
      />
    </div>
    </SessionActivityProvider>
  );
}
