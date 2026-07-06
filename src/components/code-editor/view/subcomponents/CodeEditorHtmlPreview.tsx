import { Maximize2, Minimize2, X } from 'lucide-react';

import type { CodeEditorFile } from '../../types/types';

type CodeEditorHtmlPreviewProps = {
  file: CodeEditorFile;
  content: string;
  isSidebar: boolean;
  isFullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
  labels: {
    fullscreen: string;
    exitFullscreen: string;
    close: string;
  };
};

export default function CodeEditorHtmlPreview({
  file,
  content,
  isSidebar,
  isFullscreen,
  onClose,
  onToggleFullscreen,
  labels,
}: CodeEditorHtmlPreviewProps) {
  const header = (
    <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-medium text-gray-900 dark:text-white">{file.name}</h3>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">{file.path}</p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {!isSidebar && (
          <button
            type="button"
            onClick={onToggleFullscreen}
            className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-label={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
            title={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          aria-label={labels.close}
          title={labels.close}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const body = (
    <iframe
      title={file.name}
      sandbox="allow-scripts"
      srcDoc={content}
      className="h-full w-full border-0 bg-white"
    />
  );

  if (isSidebar) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        {header}
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    );
  }

  const containerClassName = isFullscreen
    ? 'fixed inset-0 z-[9999] flex flex-col bg-background'
    : 'fixed inset-0 z-[9999] md:flex md:items-center md:justify-center md:bg-black/50 md:p-4';

  const innerClassName = isFullscreen
    ? 'flex h-full w-full flex-col bg-background'
    : 'flex h-full w-full flex-col bg-background shadow-2xl md:h-[80vh] md:max-h-[80vh] md:max-w-6xl md:rounded-lg';

  return (
    <div className={containerClassName}>
      <div className={innerClassName}>
        {header}
        <div className="min-h-0 flex-1">{body}</div>
      </div>
    </div>
  );
}
