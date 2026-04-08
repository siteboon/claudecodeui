import { useMemo, useState, type ReactNode } from 'react';
import { SystemUIContext, type SystemUIContextValue } from '@/components/refactored/shared/contexts/system-ui-context/SystemUIContext';
import { useEditorSidebar } from '@/hooks/code-editor-sidebar/useEditorSidebar';

export function SystemUIProvider({ children }: { children: ReactNode }) {
  const [sidebarIsCollapsed, setSidebarIsCollapsed] = useState(false);
  const [isChatInputFocused, setIsChatInputFocused] = useState(false);
  const {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({});

  const value = useMemo<SystemUIContextValue>(
    () => ({
      sidebarIsCollapsed,
      setSidebarIsCollapsed,
      isChatInputFocused,
      setIsChatInputFocused,
      codeEditorSidebar: {
        editingFile,
        editorWidth,
        editorExpanded,
        hasManualWidth,
        resizeHandleRef,
        handleFileOpen,
        handleCloseEditor,
        handleToggleEditorExpand,
        handleResizeStart,
      },
    }),
    [
      editingFile,
      editorExpanded,
      editorWidth,
      handleCloseEditor,
      handleFileOpen,
      handleResizeStart,
      handleToggleEditorExpand,
      hasManualWidth,
      isChatInputFocused,
      resizeHandleRef,
      sidebarIsCollapsed,
    ],
  );

  return (
    <SystemUIContext.Provider value={value}>
      {children}
    </SystemUIContext.Provider>
  );
}
