import type { CodeEditorFile } from '../../types/types';

type CodeEditorBinaryFileProps = {
  file: CodeEditorFile;
  isSidebar: boolean;
  isFullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
  title: string;
  message: string;
};

export default function CodeEditorBinaryFile({
  file,
  isSidebar,
  isFullscreen,
  onClose,
  onToggleFullscreen,
  title,
  message,
}: CodeEditorBinaryFileProps) {
  const binaryContent = (
    <div className="flex h-full w-full flex-col items-center justify-center bg-background p-8 text-muted-foreground">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <svg className="h-8 w-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <h3 className="mb-2 text-lg font-medium text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <button
          onClick={onClose}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Close
        </button>
      </div>
    </div>
  );

  if (isSidebar) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h3 className="truncate text-sm font-medium text-gray-900 dark:text-white">{file.name}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            title="Close"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {binaryContent}
      </div>
    );
  }

  const containerClassName = isFullscreen
    ? 'fixed inset-0 z-[9999] bg-background flex flex-col'
    : 'fixed inset-0 z-[9999] md:bg-black/50 md:flex md:items-center md:justify-center md:p-4';

  const innerClassName = isFullscreen
    ? 'bg-background flex flex-col w-full h-full'
    : 'bg-background shadow-2xl flex flex-col w-full h-full md:rounded-lg md:shadow-2xl md:w-full md:max-w-2xl md:h-auto md:max-h-[60vh]';

  return (
    <div className={containerClassName}>
      <div className={innerClassName}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h3 className="truncate text-sm font-medium text-gray-900 dark:text-white">{file.name}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.5 3.5M9 15v4.5M9 15H4.5M9 15l-5.5 5.5M15 9h4.5M15 9V4.5M15 9l5.5-5.5M15 15h4.5M15 15v4.5m0-4.5l5.5 5.5" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
              title="Close"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {binaryContent}
      </div>
    </div>
  );
}
