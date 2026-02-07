import MobileMenuButton from './MobileMenuButton';
import MainContentTabSwitcher from './MainContentTabSwitcher';
import MainContentTitle from './MainContentTitle';
import type { MainContentHeaderProps } from './types';

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  isMobile,
  onMenuClick,
}: MainContentHeaderProps) {
  return (
    <div className="bg-background border-b border-border p-2 sm:p-3 pwa-header-safe flex-shrink-0">
      <div className="flex items-center justify-between relative">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
          <MainContentTitle
            activeTab={activeTab}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            shouldShowTasksTab={shouldShowTasksTab}
          />
        </div>

        <div className="flex-shrink-0 hidden sm:block">
          <MainContentTabSwitcher
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            shouldShowTasksTab={shouldShowTasksTab}
          />
        </div>
      </div>
    </div>
  );
}
