import { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Folder,
  Terminal,
  GitBranch,
  ClipboardCheck,
  Ellipsis,
  Puzzle,
  Box,
  Database,
  Globe,
  Wrench,
  Zap,
  BarChart3,
  type LucideIcon,
} from 'lucide-react';
import { useTasksSettings } from '@/contexts/TasksSettingsContext';
import { usePlugins } from '@/contexts/PluginsContext';
import { useDeviceSettings } from '@/hooks/useDeviceSettings';
import { useSystemUI } from '@/components/refactored/shared/contexts/system-ui-context/useSystemUI';
import type { AppTab } from '@/types/app';

const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  Puzzle, Box, Database, Globe, Terminal, Wrench, Zap, BarChart3, Folder, MessageSquare, GitBranch,
};

type CoreTabId = Exclude<AppTab, `plugin:${string}` | 'preview'>;
type CoreNavItem = {
  id: CoreTabId;
  icon: LucideIcon;
  label: string;
};

type MobileNavRouteParams = {
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

export function MobileNav() {
  const navigate = useNavigate();
  const { t } = useTranslation(['common', 'settings']);
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { isChatInputFocused } = useSystemUI();
  const { workspaceId, sessionId, tab } = useParams<MobileNavRouteParams>();
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);
  const { plugins } = usePlugins();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  const enabledPlugins = plugins.filter((plugin) => plugin.enabled);
  const hasPlugins = enabledPlugins.length > 0;
  const activeTab = useMemo<AppTab>(() => {
    const routeTab = decodeValue(tab);
    return (routeTab || 'chat') as AppTab;
  }, [tab]);
  const isPluginActive = activeTab.startsWith('plugin:');

  useEffect(() => {
    if (!moreOpen) {
      return;
    }

    const handleTap = (event: PointerEvent) => {
      const target = event.target;
      if (moreRef.current && target instanceof Node && !moreRef.current.contains(target)) {
        setMoreOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleTap);
    return () => document.removeEventListener('pointerdown', handleTap);
  }, [moreOpen]);

  const navigateToTab = (nextTab: AppTab) => {
    if (!workspaceId && !sessionId) {
      return;
    }

    const encodedTab = encodeURIComponent(nextTab);
    const decodedSessionId = decodeValue(sessionId);

    if (decodedSessionId) {
      navigate(`/sessions/${encodeURIComponent(decodedSessionId)}/${encodedTab}`);
      return;
    }

    const encodedWorkspaceId = encodeURIComponent(decodeValue(workspaceId));
    navigate(`/workspaces/${encodedWorkspaceId}/${encodedTab}`);
  };

  const selectPlugin = (name: string) => {
    const pluginTab = `plugin:${name}` as AppTab;
    navigateToTab(pluginTab);
    setMoreOpen(false);
  };

  const baseCoreItems: CoreNavItem[] = [
    { id: 'chat', icon: MessageSquare, label: 'Chat' },
    { id: 'shell', icon: Terminal, label: 'Shell' },
    { id: 'files', icon: Folder, label: 'Files' },
    { id: 'git', icon: GitBranch, label: 'Git' },
  ];
  const coreItems: CoreNavItem[] = shouldShowTasksTab
    ? [...baseCoreItems, { id: 'tasks', icon: ClipboardCheck, label: 'Tasks' }]
    : baseCoreItems;

  if (!isMobile) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 transform px-3 pb-[max(8px,env(safe-area-inset-bottom))] transition-transform duration-300 ease-in-out ${isChatInputFocused ? 'translate-y-full' : 'translate-y-0'
        }`}
    >
      <div className="nav-glass mobile-nav-float rounded-2xl border border-border/30">
        <div className="flex items-center justify-around gap-0.5 px-1 py-1.5">
          {coreItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => navigateToTab(item.id)}
                onTouchStart={(event) => {
                  event.preventDefault();
                  navigateToTab(item.id);
                }}
                className={`relative flex flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2 transition-all duration-200 active:scale-95 ${isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
                  }`}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <div className="bg-primary/8 dark:bg-primary/12 absolute inset-0 rounded-xl" />
                )}
                <Icon
                  className={`relative z-10 transition-all duration-200 ${isActive ? 'h-5 w-5' : 'h-[18px] w-[18px]'}`}
                  strokeWidth={isActive ? 2.4 : 1.8}
                />
                <span className={`relative z-10 text-[10px] font-medium transition-all duration-200 ${isActive ? 'opacity-100' : 'opacity-60'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* "More" button - only shown when there are enabled plugins */}
          {hasPlugins && (
            <div ref={moreRef} className="relative flex-1">
              <button
                onClick={() => setMoreOpen((value) => !value)}
                onTouchStart={(event) => {
                  event.preventDefault();
                  setMoreOpen((value) => !value);
                }}
                className={`relative flex w-full touch-manipulation flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2 transition-all duration-200 active:scale-95 ${isPluginActive || moreOpen
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                  }`}
                aria-label="More plugins"
                aria-expanded={moreOpen}
              >
                {(isPluginActive && !moreOpen) && (
                  <div className="bg-primary/8 dark:bg-primary/12 absolute inset-0 rounded-xl" />
                )}
                <Ellipsis
                  className={`relative z-10 transition-all duration-200 ${isPluginActive ? 'h-5 w-5' : 'h-[18px] w-[18px]'}`}
                  strokeWidth={isPluginActive ? 2.4 : 1.8}
                />
                <span className={`relative z-10 text-[10px] font-medium transition-all duration-200 ${isPluginActive || moreOpen ? 'opacity-100' : 'opacity-60'}`}>
                  {t('settings:pluginSettings.morePlugins')}
                </span>
              </button>

              {/* Popover menu */}
              {moreOpen && (
                <div className="animate-in fade-in slide-in-from-bottom-2 absolute bottom-full right-0 z-[60] mb-2 min-w-[180px] rounded-xl border border-border/40 bg-popover py-1.5 shadow-lg duration-150">
                  {enabledPlugins.map((plugin) => {
                    const Icon = PLUGIN_ICON_MAP[plugin.icon] || Puzzle;
                    const isActive = activeTab === `plugin:${plugin.name}`;

                    return (
                      <button
                        key={plugin.name}
                        onClick={() => selectPlugin(plugin.name)}
                        className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors ${isActive
                            ? 'bg-primary/8 text-primary'
                            : 'text-foreground hover:bg-muted/60'
                          }`}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                        <span className="truncate">{plugin.displayName}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
