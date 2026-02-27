import React from 'react';
import { MessageSquare, Folder, Terminal, GitBranch, ClipboardCheck } from 'lucide-react';
import { useTasksSettings } from '../contexts/TasksSettingsContext';
import { useTaskMaster } from '../contexts/TaskMasterContext';

function MobileNav({ activeTab, setActiveTab, isInputFocused }) {
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const shouldShowTasksTab = Boolean(tasksEnabled && isTaskMasterInstalled);

  const navItems = [
    {
      id: 'chat',
      icon: MessageSquare,
      label: 'Chat',
      onClick: () => setActiveTab('chat')
    },
    {
      id: 'shell',
      icon: Terminal,
      label: 'Shell',
      onClick: () => setActiveTab('shell')
    },
    {
      id: 'files',
      icon: Folder,
      label: 'Files',
      onClick: () => setActiveTab('files')
    },
    {
      id: 'git',
      icon: GitBranch,
      label: 'Git',
      onClick: () => setActiveTab('git')
    },
    ...(shouldShowTasksTab ? [{
      id: 'tasks',
      icon: ClipboardCheck,
      label: 'Tasks',
      onClick: () => setActiveTab('tasks')
    }] : [])
  ];

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-50 px-3 pb-[max(8px,env(safe-area-inset-bottom))] transform transition-transform duration-300 ease-in-out ${
        isInputFocused ? 'translate-y-full' : 'translate-y-0'
      }`}
    >
      <div className="nav-glass mobile-nav-float rounded-2xl border border-border/30">
        <div className="flex items-center justify-around px-1 py-1.5 gap-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={item.onClick}
                onTouchStart={(e) => {
                  e.preventDefault();
                  item.onClick();
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
        </div>
      </div>
    </div>
  );
}

export default MobileNav;
