import { createContext } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { UseEditorSidebarReturn } from '@/hooks/code-editor-sidebar/useEditorSidebar';

export type SystemUIContextValue = {
  sidebarIsCollapsed: boolean;
  setSidebarIsCollapsed: Dispatch<SetStateAction<boolean>>;
  isChatInputFocused: boolean;
  setIsChatInputFocused: Dispatch<SetStateAction<boolean>>;
  codeEditorSidebar: UseEditorSidebarReturn;
};

export const SystemUIContext = createContext<SystemUIContextValue | null>(null);
