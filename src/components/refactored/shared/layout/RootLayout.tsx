import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/refactored/sidebar/view/Sidebar';
import { MainHeading } from '@/components/refactored/shared/layout/MainHeading';
import { MobileNav } from '@/components/refactored/shared/layout/MobileNav';
import { useDeviceSettings } from '@/hooks/useDeviceSettings';

export function RootLayout() {
  const { isMobile } = useDeviceSettings({ trackPWA: false });

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className={`flex min-w-0 flex-1 flex-col ${isMobile ? 'pb-mobile-nav' : ''}`}>
        <MainHeading />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
