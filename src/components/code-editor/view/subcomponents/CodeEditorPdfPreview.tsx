import { useEffect, useState } from 'react';
import { api } from '../../../../utils/api';
import type { CodeEditorFile } from '../../types/types';

type CodeEditorPdfPreviewProps = {
  file: CodeEditorFile;
  isSidebar: boolean;
  isFullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
};

export default function CodeEditorPdfPreview({
  file,
  isSidebar,
  isFullscreen,
  onClose,
  onToggleFullscreen,
}: CodeEditorPdfPreviewProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    const loadPdf = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await api.readFileBlob(file.projectId ?? '', file.path);

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Error loading PDF:', err);
        setError('Unable to load PDF');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.path, file.projectId]);

  const previewContent = (
    <div className="flex h-full w-full flex-col bg-[#1e1e1e]">
      {loading && (
        <div className="flex flex-1 items-center justify-center text-gray-400">
          <div>
            <div className="mb-2 h-8 w-8 animate-spin rounded-full border-2 border-gray-500 border-t-transparent mx-auto" />
            <p className="text-sm">Loading PDF...</p>
          </div>
        </div>
      )}
      {!loading && pdfUrl && (
        <iframe
          src={pdfUrl}
          className="h-full w-full flex-1 border-0"
          title={file.name}
        />
      )}
      {!loading && (error || !pdfUrl) && (
        <div className="flex flex-1 items-center justify-center text-gray-400">
          <div className="text-center">
            <p>{error || 'Unable to load PDF'}</p>
            <p className="mt-2 break-all text-xs text-gray-500">{file.path}</p>
          </div>
        </div>
      )}
    </div>
  );

  if (isSidebar) {
    return (
      <div className="flex h-full w-full flex-col bg-[#1e1e1e]">
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-700 px-3 py-1.5">
          <h3 className="truncate text-sm font-medium text-gray-200">{file.name}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white"
            title="Close"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {previewContent}
      </div>
    );
  }

  const containerClass = isFullscreen
    ? 'fixed inset-0 z-[9999] bg-[#1e1e1e] flex flex-col'
    : 'fixed inset-0 z-[9999] md:bg-black/50 md:flex md:items-center md:justify-center md:p-4';

  const innerClass = isFullscreen
    ? 'flex flex-col w-full h-full'
    : 'bg-[#1e1e1e] shadow-2xl flex flex-col w-full h-full md:rounded-lg md:w-full md:max-w-4xl md:h-[85vh]';

  return (
    <div className={containerClass}>
      <div className={innerClass}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-700 px-3 py-1.5">
          <h3 className="truncate text-sm font-medium text-gray-200">{file.name}</h3>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onToggleFullscreen}
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white"
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
              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white"
              title="Close"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        {previewContent}
        <div className="border-t border-gray-700 bg-[#252526] px-3 py-1.5">
          <p className="text-xs text-gray-500">{file.path}</p>
        </div>
      </div>
    </div>
  );
}
