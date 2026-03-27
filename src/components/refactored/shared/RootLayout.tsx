
import { Outlet } from 'react-router-dom';
import { Sidebar } from '@/components/refactored/sidebar/view/Sidebar';


export function RootLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <main className="relative flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
