import { useState } from 'react';
import CodeEditor from '../../../CodeEditor';
import type { EditorSidebarProps } from '../../types/types';

const AnyCodeEditor = CodeEditor as any;

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

  if (!editingFile) {
    return null;
  }

  if (isMobile || poppedOut) {
    return (
      <AnyCodeEditor
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

  // Keep "fill space" as default in files tab, but allow user drag to take control.
  const useFlex = editorExpanded || (fillSpace && !hasManualWidth);

  return (
    <>
      {!editorExpanded && (
        <div
          ref={resizeHandleRef}
          onMouseDown={onResizeStart}
          className="flex-shrink-0 w-1 bg-gray-200 dark:bg-gray-700 hover:bg-blue-500 dark:hover:bg-blue-600 cursor-col-resize transition-colors relative group"
          title="Drag to resize"
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-1 bg-blue-500 dark:bg-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}

      <div
        className={`flex-shrink-0 border-l border-gray-200 dark:border-gray-700 h-full overflow-hidden ${useFlex ? 'flex-1' : ''}`}
        style={useFlex ? undefined : { width: `${editorWidth}px` }}
      >
        <AnyCodeEditor
          file={editingFile}
          onClose={onCloseEditor}
          projectPath={projectPath}
          isSidebar
          isExpanded={editorExpanded}
          onToggleExpand={onToggleEditorExpand}
          onPopOut={() => setPoppedOut(true)}
        />
      </div>
    </>
  );
}
