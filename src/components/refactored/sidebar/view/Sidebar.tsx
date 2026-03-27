import { PanelRightOpen } from 'lucide-react';
import { useSidebarSettings } from '../hooks/useSidebarSettings';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useSidebarModals } from '../hooks/useSidebarModals';
import SidebarHeader from './SidebarHeader';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/view/ui';
import ProjectCreationWizard from '@/components/project-creation-wizard';

export function Sidebar() {
  const { isCollapsed, toggleCollapse, setCollapsed } = useSidebarSettings();
  const { workspaces, isRefreshing, refreshWorkspaces } = useWorkspaces();
  const { showNewProject, openNewProject, closeNewProject } = useSidebarModals();

  return (
    <>
      <>
        {/* Mobile Backdrop Overlay - allows tapping outside to close */}
        {!isCollapsed && (
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm md:hidden"
            onClick={() => setCollapsed(true)}
          />
        )}

        <aside
          className={cn(
            "flex flex-col bg-background/80 backdrop-blur-sm transition-all duration-300 border-r border-border h-full",
            "fixed inset-y-0 left-0 z-50 md:relative md:z-0", // Make it fixed drawer on mobile, relative on desktop
            isCollapsed
              ? "-translate-x-full md:translate-x-0 md:w-0 md:opacity-0 md:overflow-hidden md:border-none" // Hide fully on mobile if collapsed
              : "translate-x-0 w-[85vw] sm:w-80 md:w-72 opacity-100"
          )}
        >
          <SidebarHeader
            isCollapsed={isCollapsed}
            onToggleCollapse={toggleCollapse}
            isRefreshing={isRefreshing}
            onRefresh={refreshWorkspaces}
            onNewProject={openNewProject}
          />
          {/* Placeholder for the rest of the sidebar content */}
          {!isCollapsed && (
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {/* Future list component will go here */}
              {/* Can pass workspaces to the future list component as props */}
            </div>
          )}
        </aside>

        {/* Collapsed view handle - Only show on desktop since mobile hides it completely behind a toggle usually, but let's keep it consistent or standard. */}
        {isCollapsed && (
          <aside className="fixed inset-y-0 left-0 z-40 flex h-full flex-col items-center border-r border-border bg-background/80 px-2 py-4 md:relative">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
              onClick={() => setCollapsed(false)}
              title="Show Sidebar"
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          </aside>
        )}
      </>

      {/* MODALS */}
      {showNewProject && (
        <ProjectCreationWizard
          onClose={closeNewProject}
          onProjectCreated={refreshWorkspaces}
        />
      )}
    </>
  );
}
