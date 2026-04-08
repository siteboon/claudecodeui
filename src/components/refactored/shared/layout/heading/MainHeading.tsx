import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AppTab, SessionProvider } from '@/types/app';
import { usePlugins } from '@/contexts/PluginsContext';
import { useDeviceSettings } from '@/hooks/useDeviceSettings';
import { useSystemUI } from '@/components/refactored/shared/contexts/system-ui-context/useSystemUI';
import { MainHeadingTabSwitcher } from '@/components/refactored/shared/layout/heading/MainHeadingTabSwitcher';
import { getSessionById, getWorkspaceById } from '@/components/refactored/sidebar/data/workspacesApi';

type MainHeadingRouteParams = {
  workspaceId?: string;
  sessionId?: string;
  tab?: string;
};

const decodeValue = (value?: string): string => {
  if (!value) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const resolveTabFromPathname = (pathname: string): string => {
  const normalizedPath = pathname.replace(/\/+$/, '');
  const segments = normalizedPath.split('/').filter(Boolean);

  if (segments.length >= 3 && (segments[0] === 'workspaces' || segments[0] === 'sessions')) {
    return decodeValue(segments[2]);
  }

  return '';
};

const getTabTitle = (tab: AppTab, pluginDisplayName: string | undefined, t: (key: string) => string) => {
  if (tab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (tab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (tab === 'git') {
    return t('tabs.git');
  }

  if (tab === 'tasks') {
    return 'TaskMaster';
  }

  if (tab === 'shell') {
    return t('tabs.shell');
  }

  return t('tabs.chat');
};

const getStoredModelForProvider = (provider: SessionProvider): string => {
  const storageKeyByProvider: Record<SessionProvider, string> = {
    claude: 'claude-model',
    cursor: 'cursor-model',
    codex: 'codex-model',
    gemini: 'gemini-model',
  };

  const model = localStorage.getItem(storageKeyByProvider[provider]);
  return typeof model === 'string' ? model.trim() : '';
};

const getTrimmedOrEmpty = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function MainHeading() {
  const navigate = useNavigate();
  const { t } = useTranslation(['common', 'sidebar']);
  const { plugins } = usePlugins();
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { sidebarIsCollapsed, setSidebarIsCollapsed } = useSystemUI();
  const { workspaceId, sessionId, tab } = useParams<MainHeadingRouteParams>();
  const location = useLocation();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [resolvedWorkspacePath, setResolvedWorkspacePath] = useState('');
  const [resolvedSessionTitle, setResolvedSessionTitle] = useState('');
  const [resolvedSessionWorkspacePath, setResolvedSessionWorkspacePath] = useState('');

  const decodedWorkspaceId = useMemo(() => decodeValue(workspaceId), [workspaceId]);
  const decodedSessionId = useMemo(() => decodeValue(sessionId), [sessionId]);
  const pluginName = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return decodeValue(params.get('name') ?? undefined);
  }, [location.search]);
  const activeTab = useMemo<AppTab>(() => {
    const routeTab = decodeValue(tab) || resolveTabFromPathname(location.pathname);
    if (routeTab === 'plugins' && pluginName) {
      return `plugin:${pluginName}` as AppTab;
    }

    return (routeTab || 'chat') as AppTab;
  }, [location.pathname, pluginName, tab]);

  const pluginDisplayName = useMemo(
    () =>
      activeTab.startsWith('plugin:')
        ? plugins.find((plugin) => plugin.name === activeTab.replace('plugin:', ''))?.displayName
        : undefined,
    [activeTab, plugins],
  );

  useEffect(() => {
    if (!decodedWorkspaceId) {
      setResolvedWorkspacePath('');
      return;
    }

    let disposed = false;

    const loadWorkspace = async () => {
      try {
        const workspace = await getWorkspaceById(decodedWorkspaceId);
        if (disposed) {
          return;
        }

        const pathValue =
          getTrimmedOrEmpty(workspace.workspaceOriginalPath) ||
          decodedWorkspaceId;
        setResolvedWorkspacePath(pathValue);
      } catch {
        if (!disposed) {
          setResolvedWorkspacePath(decodedWorkspaceId);
        }
      }
    };

    void loadWorkspace();

    return () => {
      disposed = true;
    };
  }, [decodedWorkspaceId]);

  useEffect(() => {
    if (!decodedSessionId) {
      setResolvedSessionTitle('');
      setResolvedSessionWorkspacePath('');
      return;
    }

    let disposed = false;

    const loadSession = async () => {
      try {
        const session = await getSessionById(decodedSessionId);
        if (disposed) {
          return;
        }

        const customName = getTrimmedOrEmpty(session.custom_name);
        const modelName = getStoredModelForProvider(session.provider);
        setResolvedSessionTitle(customName || modelName || decodedSessionId);
        setResolvedSessionWorkspacePath(getTrimmedOrEmpty(session.workspace_path));

        const workspaceIdFromSession = getTrimmedOrEmpty(session.workspace_id);
        if (!workspaceIdFromSession) {
          if (!decodedWorkspaceId) {
            setResolvedWorkspacePath(getTrimmedOrEmpty(session.workspace_path));
          }
          return;
        }

        try {
          const workspace = await getWorkspaceById(workspaceIdFromSession);
          if (disposed) {
            return;
          }

          const workspacePath =
            getTrimmedOrEmpty(workspace.workspaceOriginalPath) ||
            workspaceIdFromSession;
          setResolvedWorkspacePath(workspacePath);
        } catch {
          if (!disposed && !decodedWorkspaceId) {
            setResolvedWorkspacePath(getTrimmedOrEmpty(session.workspace_path));
          }
        }
      } catch {
        if (!disposed) {
          setResolvedSessionTitle(decodedSessionId);
        }
      }
    };

    void loadSession();

    return () => {
      disposed = true;
    };
  }, [decodedSessionId, decodedWorkspaceId]);

  const title = useMemo(() => {
    if (activeTab === 'chat' && decodedSessionId) {
      return resolvedSessionTitle || decodedSessionId;
    }

    if (activeTab === 'chat') {
      return t('mainContent.newSession');
    }

    return getTabTitle(activeTab, pluginDisplayName, t);
  }, [activeTab, decodedSessionId, pluginDisplayName, resolvedSessionTitle, t]);

  const subtitle = useMemo(() => (
    resolvedSessionWorkspacePath ||
    resolvedWorkspacePath ||
    decodedWorkspaceId ||
    t('mainContent.newSession')
  ), [decodedWorkspaceId, resolvedSessionWorkspacePath, resolvedWorkspacePath, t]);

  const updateScrollState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }

    setCanScrollLeft(element.scrollLeft > 2);
    setCanScrollRight(element.scrollLeft < element.scrollWidth - element.clientWidth - 2);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || isMobile) {
      return;
    }

    updateScrollState();
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(element);

    return () => observer.disconnect();
  }, [isMobile, updateScrollState]);

  if (!workspaceId && !sessionId) {
    return null;
  }

  const handleTabSelect = (nextTab: AppTab) => {
    // Preserve route context while switching only the active tab path segment.
    const isPluginTab = nextTab.startsWith('plugin:');
    const pluginTabName = isPluginTab ? nextTab.replace('plugin:', '') : '';
    const targetTab = isPluginTab ? 'plugins' : nextTab;
    const encodedTargetTab = encodeURIComponent(targetTab);
    const pluginQuery = isPluginTab ? `?name=${encodeURIComponent(pluginTabName)}` : '';

    if (decodedSessionId) {
      navigate(`/sessions/${encodeURIComponent(decodedSessionId)}/${encodedTargetTab}${pluginQuery}`);
      return;
    }

    const encodedWorkspaceId = encodeURIComponent(decodedWorkspaceId);
    navigate(`/workspaces/${encodedWorkspaceId}/${encodedTargetTab}${pluginQuery}`);
  };

  return (
    <div className="pwa-header-safe flex-shrink-0 border-b border-border/60 bg-background px-3 py-1.5 sm:px-4 sm:py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isMobile && (
            <button
              onClick={() => setSidebarIsCollapsed((previousValue) => !previousValue)}
              className="pwa-menu-button flex-shrink-0 touch-manipulation rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground active:scale-95"
              aria-label={sidebarIsCollapsed ? t('common:versionUpdate.ariaLabels.showSidebar') : t('sidebar:tooltips.hideSidebar')}
              title={sidebarIsCollapsed ? t('common:versionUpdate.ariaLabels.showSidebar') : t('sidebar:tooltips.hideSidebar')}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          )}

          <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            <div className="min-w-0 flex-1">
              <h2 className="scrollbar-hide overflow-x-auto whitespace-nowrap text-sm font-semibold leading-tight text-foreground">
                {title}
              </h2>
              <div className="truncate text-[11px] leading-tight text-muted-foreground">
                {subtitle}
              </div>
            </div>
          </div>
        </div>

        {!isMobile && (
          <div className="relative min-w-0 flex-shrink overflow-hidden sm:flex-shrink-0">
            {canScrollLeft && (
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-background to-transparent" />
            )}
            <div
              ref={scrollRef}
              onScroll={updateScrollState}
              className="scrollbar-hide overflow-x-auto"
            >
              <MainHeadingTabSwitcher activeTab={activeTab} onTabSelect={handleTabSelect} />
            </div>
            {canScrollRight && (
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-background to-transparent" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
