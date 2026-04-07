import { useMemo, useState, type ReactNode } from 'react';
import { SystemUIContext, type SystemUIContextValue } from '@/components/refactored/shared/contexts/system-ui-context/SystemUIContext';

export function SystemUIProvider({ children }: { children: ReactNode }) {
  const [sidebarIsCollapsed, setSidebarIsCollapsed] = useState(false);
  const [isChatInputFocused, setIsChatInputFocused] = useState(false);

  const value = useMemo<SystemUIContextValue>(
    () => ({
      sidebarIsCollapsed,
      setSidebarIsCollapsed,
      isChatInputFocused,
      setIsChatInputFocused,
    }),
    [isChatInputFocused, sidebarIsCollapsed],
  );

  return (
    <SystemUIContext.Provider value={value}>
      {children}
    </SystemUIContext.Provider>
  );
}
