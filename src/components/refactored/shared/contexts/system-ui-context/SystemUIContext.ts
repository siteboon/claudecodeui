import { createContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export type SystemUIContextValue = {
  sidebarIsCollapsed: boolean;
  setSidebarIsCollapsed: Dispatch<SetStateAction<boolean>>;
  isChatInputFocused: boolean;
  setIsChatInputFocused: Dispatch<SetStateAction<boolean>>;
};

export const SystemUIContext = createContext<SystemUIContextValue | null>(null);
