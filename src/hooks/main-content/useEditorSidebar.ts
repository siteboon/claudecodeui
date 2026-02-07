import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Project } from '../../types/app';
import type { DiffInfo, EditingFile } from '../../components/main-content/types';

type UseEditorSidebarOptions = {
  selectedProject: Project | null;
  isMobile: boolean;
  initialWidth?: number;
};

export function useEditorSidebar({
  selectedProject,
  isMobile,
  initialWidth = 600,
}: UseEditorSidebarOptions) {
  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [editorWidth, setEditorWidth] = useState(initialWidth);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);

  const handleFileOpen = useCallback(
    (filePath: string, diffInfo: DiffInfo | null = null) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const fileName = normalizedPath.split('/').pop() || filePath;

      setEditingFile({
        name: fileName,
        path: filePath,
        projectName: selectedProject?.name,
        diffInfo,
      });
    },
    [selectedProject?.name],
  );

  const handleCloseEditor = useCallback(() => {
    setEditingFile(null);
    setEditorExpanded(false);
  }, []);

  const handleToggleEditorExpand = useCallback(() => {
    setEditorExpanded((prev) => !prev);
  }, []);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) {
        return;
      }

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

      const container = resizeHandleRef.current?.parentElement;
      if (!container) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
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
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleToggleEditorExpand,
    handleResizeStart,
  };
}
