import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { AppTab } from '@/types/app';
import { usePlugins } from '@/contexts/PluginsContext';
import { useDeviceSettings } from '@/hooks/useDeviceSettings';
import { useSystemUI } from '@/components/refactored/shared/contexts/system-ui-context/useSystemUI';
import { MainHeadingTabSwitcher } from '@/components/refactored/shared/layout/MainHeadingTabSwitcher';

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

export function MainHeading() {
  const navigate = useNavigate();
  const { t } = useTranslation(['common', 'sidebar']);
  const { plugins } = usePlugins();
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { sidebarIsCollapsed, setSidebarIsCollapsed } = useSystemUI();
  const { workspaceId, sessionId, tab } = useParams<MainHeadingRouteParams>();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const decodedWorkspaceId = useMemo(() => decodeValue(workspaceId), [workspaceId]);
  const decodedSessionId = useMemo(() => decodeValue(sessionId), [sessionId]);
  const activeTab = useMemo<AppTab>(() => {
    const routeTab = decodeValue(tab);
    return (routeTab || 'chat') as AppTab;
  }, [tab]);

  const pluginDisplayName = useMemo(
    () =>
      activeTab.startsWith('plugin:')
        ? plugins.find((plugin) => plugin.name === activeTab.replace('plugin:', ''))?.displayName
        : undefined,
    [activeTab, plugins],
  );

  const title = useMemo(() => {
    if (activeTab === 'chat' && decodedSessionId) {
      return decodedSessionId;
    }

    if (activeTab === 'chat') {
      return t('mainContent.newSession');
    }

    return getTabTitle(activeTab, pluginDisplayName, t);
  }, [activeTab, decodedSessionId, pluginDisplayName, t]);

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

  if (!workspaceId) {
    return null;
  }

  const handleTabSelect = (nextTab: AppTab) => {
    // Preserve workspace/session context while switching only the active tab path segment.
    const encodedWorkspaceId = encodeURIComponent(decodedWorkspaceId);
    const encodedTab = encodeURIComponent(nextTab);

    if (decodedSessionId) {
      navigate(
        `/workspaces/${encodedWorkspaceId}/sessions/${encodeURIComponent(decodedSessionId)}/${encodedTab}`,
      );
      return;
    }

    navigate(`/workspaces/${encodedWorkspaceId}/${encodedTab}`);
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
                {decodedWorkspaceId}
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
