import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Folder, Terminal, GitBranch, ClipboardCheck, Ellipsis, Puzzle, Box, Database, Globe, Wrench, Zap, BarChart3 } from 'lucide-react';
import { useTasksSettings } from '../contexts/TasksSettingsContext';
import { useTaskMaster } from '../contexts/TaskMasterContext';
import { usePlugins } from '../contexts/PluginsContext';

const PLUGIN_ICON_MAP = {
  Puzzle, Box, Database, Globe, Terminal, Wrench, Zap, BarChart3, Folder, MessageSquare, GitBranch,
};

function MobileNav({ activeTab, setActiveTab, isInputFocused }) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);
  const { plugins } = usePlugins();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  const enabledPlugins = plugins.filter((p) => p.enabled);
  const hasPlugins = enabledPlugins.length > 0;
  const isPluginActive = activeTab.startsWith('plugin:');

  // Close the menu on outside tap
  useEffect(() => {
    if (!moreOpen) return;
    const handleTap = (e) => {
      if (moreRef.current && !moreRef.current.contains(e.target)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleTap);
    return () => document.removeEventListener('pointerdown', handleTap);
  }, [moreOpen]);

  // Close menu when a plugin tab is selected
  const selectPlugin = (name) => {
    setActiveTab(`plugin:${name}`);
    setMoreOpen(false);
  };

  const coreItems = [
    { id: 'chat', icon: MessageSquare, label: 'Chat' },
    { id: 'shell', icon: Terminal, label: 'Shell' },
    { id: 'files', icon: Folder, label: 'Files' },
    { id: 'git', icon: GitBranch, label: 'Git' },
    ...(shouldShowTasksTab ? [{ id: 'tasks', icon: ClipboardCheck, label: 'Tasks' }] : []),
  ];

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 px-3 pb-[max(8px,env(safe-area-inset-bottom))] transform transition-transform duration-300 ease-in-out ${
        isInputFocused ? 'translate-y-full' : 'translate-y-0'
      }`}
    >
      <div className="nav-glass mobile-nav-float rounded-2xl border border-border/30">
        <div className="flex items-center justify-around px-1 py-1.5 gap-0.5">
          {coreItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                onTouchStart={(e) => {
                  e.preventDefault();
                  setActiveTab(item.id);
                }}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-xl flex-1 relative touch-manipulation transition-all duration-200 active:scale-95 ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-primary/8 dark:bg-primary/12 rounded-xl" />
                )}
                <Icon
                  className={`relative z-10 transition-all duration-200 ${isActive ? 'w-5 h-5' : 'w-[18px] h-[18px]'}`}
                  strokeWidth={isActive ? 2.4 : 1.8}
                />
                <span className={`relative z-10 text-[10px] font-medium transition-all duration-200 ${isActive ? 'opacity-100' : 'opacity-60'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* "More" button — only shown when there are enabled plugins */}
          {hasPlugins && (
            <div ref={moreRef} className="relative flex-1">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                onTouchStart={(e) => {
                  e.preventDefault();
                  setMoreOpen((v) => !v);
                }}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 py-2 rounded-xl w-full relative touch-manipulation transition-all duration-200 active:scale-95 ${
                  isPluginActive || moreOpen
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-label="More plugins"
                aria-expanded={moreOpen}
              >
                {(isPluginActive && !moreOpen) && (
                  <div className="absolute inset-0 bg-primary/8 dark:bg-primary/12 rounded-xl" />
                )}
                <Ellipsis
                  className={`relative z-10 transition-all duration-200 ${isPluginActive ? 'w-5 h-5' : 'w-[18px] h-[18px]'}`}
                  strokeWidth={isPluginActive ? 2.4 : 1.8}
                />
                <span className={`relative z-10 text-[10px] font-medium transition-all duration-200 ${isPluginActive || moreOpen ? 'opacity-100' : 'opacity-60'}`}>
                  More
                </span>
              </button>

              {/* Popover menu */}
              {moreOpen && (
                <div className="absolute bottom-full mb-2 right-0 min-w-[180px] py-1.5 rounded-xl border border-border/40 bg-popover shadow-lg z-[60] animate-in fade-in slide-in-from-bottom-2 duration-150">
                  {enabledPlugins.map((p) => {
                    const Icon = PLUGIN_ICON_MAP[p.icon] || Puzzle;
                    const isActive = activeTab === `plugin:${p.name}`;

                    return (
                      <button
                        key={p.name}
                        onClick={() => selectPlugin(p.name)}
                        className={`flex items-center gap-2.5 w-full px-3.5 py-2.5 text-sm transition-colors ${
                          isActive
                            ? 'text-primary bg-primary/8'
                            : 'text-foreground hover:bg-muted/60'
                        }`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                        <span className="truncate">{p.displayName}</span>
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

export default MobileNav;
