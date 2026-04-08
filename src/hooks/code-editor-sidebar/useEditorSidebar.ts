import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react';
import { CodeEditorFile, CodeEditorDiffInfo } from '@/hooks/code-editor-sidebar/types.js';
import { useDeviceSettings } from '@/hooks/useDeviceSettings.js';


type UseEditorSidebarOptions = {
  initialWidth?: number;
};

export type OpenEditorFileHandler = (
  filePath: string,
  diffInfo?: CodeEditorDiffInfo | null,
  projectName?: string,
) => void;

export type UseEditorSidebarReturn = {
  editingFile: CodeEditorFile | null;
  editorWidth: number;
  editorExpanded: boolean;
  hasManualWidth: boolean;
  resizeHandleRef: MutableRefObject<HTMLDivElement | null>;
  handleFileOpen: OpenEditorFileHandler;
  handleCloseEditor: () => void;
  handleToggleEditorExpand: () => void;
  handleResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

// TODO: Remove every parameter here (except initial width)
// selectedProject is only used to set projectName on the file being edited. It turns out that projectName 
// isn't actually used anywhere in the code editor, so it can be removed without affecting functionality. If we do want to keep track of projectName for some reason, we can set it in the MainContent component where the file is opened instead of here.
// isMobile should be found from useDeviceSettings hook
// 
export const useEditorSidebar = ({
  initialWidth = 600,
}: UseEditorSidebarOptions): UseEditorSidebarReturn => {
  const [editingFile, setEditingFile] = useState<CodeEditorFile | null>(null);
  const [editorWidth, setEditorWidth] = useState(initialWidth);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [hasManualWidth, setHasManualWidth] = useState(false);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);

  const { isMobile } = useDeviceSettings({ trackPWA: false });

  const handleFileOpen = useCallback<OpenEditorFileHandler>(
    (filePath, diffInfo = null, projectName) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const fileName = normalizedPath.split('/').pop() || filePath;

      setEditingFile({
        name: fileName,
        path: filePath,
        projectName,
        diffInfo,
      });
    },
    [],
  );

  const handleCloseEditor = useCallback(() => {
    setEditingFile(null);
    setEditorExpanded(false);
  }, []);

  const handleToggleEditorExpand = useCallback(() => {
    setEditorExpanded((previous) => !previous);
  }, []);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) {
        return;
      }

      // After first drag interaction, the editor width is user-controlled.
      setHasManualWidth(true);
      setIsResizing(true);
      event.preventDefault();
    },
    [isMobile],
  );

  useEffect(() => {
    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!isResizing) {
        return;
      }

      // Get the main container (parent of EditorSidebar's parent) that contains both left content and editor
      const editorContainer = resizeHandleRef.current?.parentElement;
      const mainContainer = editorContainer?.parentElement;
      if (!mainContainer) {
        return;
      }

      const containerRect = mainContainer.getBoundingClientRect();
      // Calculate new editor width: distance from mouse to right edge of main container
      const newWidth = containerRect.right - event.clientX;

      const minWidth = 300;
      const maxWidth = containerRect.width * 0.8;

      if (newWidth >= minWidth && newWidth <= maxWidth) {
        setEditorWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return {
    editingFile,
    editorWidth,
    editorExpanded,
    hasManualWidth,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  };
};
