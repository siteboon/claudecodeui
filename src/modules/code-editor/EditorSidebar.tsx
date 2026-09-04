import { useState, useEffect, useRef } from 'react';
import type { MouseEvent, MutableRefObject } from 'react';

import type { CodeEditorFile } from '@/shared/types';
import CodeEditor from '@/modules/code-editor/CodeEditor';

type EditorSidebarProps = {
  editingFile: CodeEditorFile | null;
  isMobile: boolean;
  editorExpanded: boolean;
  editorWidth: number;
  hasManualWidth: boolean;
  resizeHandleRef: MutableRefObject<HTMLDivElement | null>;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onCloseEditor: () => void;
  onToggleEditorExpand: () => void;
  projectPath?: string;
  fillSpace?: boolean;
};

// Minimum width for the left content (file tree, chat, etc.)
const MIN_LEFT_CONTENT_WIDTH = 200;
// Minimum width for the editor sidebar
const MIN_EDITOR_WIDTH = 280;

/** Used by the project-workspace module to dock the code editor beside the workspace content, with drag-to-resize and pop-out behaviour. */
export default function EditorSidebar({
  editingFile,
  isMobile,
  editorExpanded,
  editorWidth,
  hasManualWidth,
  resizeHandleRef,
  onResizeStart,
  onCloseEditor,
  onToggleEditorExpand,
  projectPath,
  fillSpace,
}: EditorSidebarProps) {
  const [poppedOut, setPoppedOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Only the ceiling is state; the applied width is derived below. Holding a
  // second copy of the width meant every drag frame rendered twice, and keeping
  // `editorWidth` in this effect's dependencies rebuilt the ResizeObserver on
  // every one of those frames.
  const [maxEditorWidth, setMaxEditorWidth] = useState<number | null>(null);

  // Track how much room the container can spare so the left content keeps at
  // least MIN_LEFT_CONTENT_WIDTH as the window resizes.
  useEffect(() => {
    if (!editingFile || isMobile || poppedOut) return;

    const updateAvailableWidth = () => {
      if (!containerRef.current) return;
      const parentElement = containerRef.current.parentElement;
      if (!parentElement) return;

      const availableWidth = parentElement.clientWidth - MIN_LEFT_CONTENT_WIDTH;

      if (availableWidth < MIN_EDITOR_WIDTH) {
        // Not enough space - pop out the editor so user can still see everything
        setPoppedOut(true);
        return;
      }

      setMaxEditorWidth(availableWidth);
    };

    updateAvailableWidth();
    window.addEventListener('resize', updateAvailableWidth);

    // Also use ResizeObserver for more accurate detection
    const resizeObserver = new ResizeObserver(updateAvailableWidth);
    const parentEl = containerRef.current?.parentElement;
    if (parentEl) {
      resizeObserver.observe(parentEl);
    }

    return () => {
      window.removeEventListener('resize', updateAvailableWidth);
      resizeObserver.disconnect();
    };
  }, [editingFile, isMobile, poppedOut]);

  const effectiveWidth = maxEditorWidth === null
    ? editorWidth
    : Math.min(editorWidth, maxEditorWidth);

  if (!editingFile) {
    return null;
  }

  if (isMobile || poppedOut) {
    return (
      <CodeEditor
        file={editingFile}
        onClose={() => {
          setPoppedOut(false);
          onCloseEditor();
        }}
        projectPath={projectPath}
        isSidebar={false}
      />
    );
  }

  // In files tab, fill the remaining width unless user has dragged manually.
  const useFlexLayout = editorExpanded || (fillSpace && !hasManualWidth);

  return (
    <div ref={containerRef} className={`flex h-full min-w-0 ${editorExpanded ? 'flex-1' : ''}`}>
      {!editorExpanded && (
        <div
          ref={resizeHandleRef}
          onMouseDown={onResizeStart}
          className="group relative w-1 flex-shrink-0 cursor-col-resize bg-gray-200 transition-colors hover:bg-blue-500 dark:bg-gray-700 dark:hover:bg-blue-600"
          title="Drag to resize"
        >
          <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-blue-500 opacity-0 transition-opacity group-hover:opacity-100 dark:bg-blue-600" />
        </div>
      )}

      <div
        className={`h-full overflow-hidden border-l border-gray-200 dark:border-gray-700 ${useFlexLayout ? 'min-w-0 flex-1' : ''}`}
        style={useFlexLayout ? undefined : { width: `${effectiveWidth}px`, minWidth: `${MIN_EDITOR_WIDTH}px` }}
      >
        <CodeEditor
          file={editingFile}
          onClose={onCloseEditor}
          projectPath={projectPath}
          isSidebar
          isExpanded={editorExpanded}
          onToggleExpand={onToggleEditorExpand}
          onPopOut={() => setPoppedOut(true)}
        />
      </div>
    </div>
  );
}
