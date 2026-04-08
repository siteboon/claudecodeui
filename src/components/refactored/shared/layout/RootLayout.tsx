import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/refactored/sidebar/view/Sidebar';
import { MainHeading } from '@/components/refactored/shared/layout/heading/MainHeading';
import { MobileNav } from '@/components/refactored/shared/layout/MobileNav';
import EditorSidebarRouterAdapter from '@/components/code-editor/view/EditorSidebarRouterAdapter';
import { useDeviceSettings } from '@/hooks/useDeviceSettings';
import { useSystemUI } from '@/components/refactored/shared/contexts/system-ui-context/useSystemUI.js';

export function RootLayout() {
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { codeEditorSidebar: { editorExpanded } } = useSystemUI();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className={`flex min-w-0 flex-1 flex-col ${isMobile ? 'pb-mobile-nav' : ''}`}>
        <MainHeading />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 overflow-hidden">
            <div className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${editorExpanded ? 'hidden' : ''}`}>
              <Outlet />
            </div>
            <EditorSidebarRouterAdapter />
          </div>
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
