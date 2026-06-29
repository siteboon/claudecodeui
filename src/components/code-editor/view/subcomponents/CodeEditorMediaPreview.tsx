import { useEffect, useState } from 'react';
import { authenticatedFetch } from '../../../../utils/api';
import type { CodeEditorFile } from '../../types/types';
import { getPreviewMimeType, type PreviewKind } from '../../utils/previewableFile';

type CodeEditorMediaPreviewProps = {
  file: CodeEditorFile;
  kind: PreviewKind;
  // DB projectId used to build the raw-content URL; falls back to projectPath
  // for older callers, mirroring useCodeEditorDocument.
  projectId?: string;
  isSidebar: boolean;
  isFullscreen: boolean;
  onClose: () => void;
  onToggleFullscreen: () => void;
  labels: {
    loading: string;
    error: string;
    openInNewTab: string;
    fullscreen: string;
    exitFullscreen: string;
    close: string;
  };
};

// Reject a "PDF" whose bytes aren't actually a PDF before handing it to the
// same-origin iframe, so a mislabeled HTML/SVG file can't run in the app origin.
const PDF_HEADER_SCAN_BYTES = 1024;

const looksLikePdf = async (blob: Blob): Promise<boolean> => {
  const header = await blob.slice(0, PDF_HEADER_SCAN_BYTES).arrayBuffer();
  // PDFs must contain the "%PDF-" marker at the very start of the file.
  return new TextDecoder('latin1').decode(header).includes('%PDF-');
};

export default function CodeEditorMediaPreview({
  file,
  kind,
  projectId,
  isSidebar,
  isFullscreen,
  onClose,
  onToggleFullscreen,
  labels,
}: CodeEditorMediaPreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) {
      setError(labels.error);
      setLoading(false);
      return;
    }

    let objectUrl: string | null = null;
    const controller = new AbortController();

    const loadMedia = async () => {
      try {
        setLoading(true);
        setError(null);
        setUrl(null);

        // The content endpoint requires the auth header, so we fetch the bytes
        // ourselves and hand the media element a blob URL instead of a bare src.
        // Fetching a blob (rather than streaming) also lets <video>/<audio> seek.
        const contentUrl = `/api/projects/${projectId}/files/content?path=${encodeURIComponent(file.path)}`;
        const response = await authenticatedFetch(contentUrl, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const blob = await response.blob();

        // Pick the MIME type to expose to the browser. Preserve a valid
        // Content-Type from the server, but supply an extension-specific
        // default when it is missing or generic (application/octet-stream),
        // otherwise formats like webm/ogg/flac/svg won't render.
        const fallbackMime = getPreviewMimeType(file.name);
        const isGenericType = !blob.type || blob.type === 'application/octet-stream';
        let outType = isGenericType ? (fallbackMime ?? blob.type) : blob.type;

        if (kind === 'pdf') {
          // The PDF renders in a same-origin <iframe>, so verify the bytes are
          // really a PDF and pin the type to application/pdf. That forces the
          // browser's PDF handler and prevents a mislabeled HTML/SVG file from
          // executing scripts in the app's origin.
          if (!(await looksLikePdf(blob))) {
            throw new Error('File is not a valid PDF');
          }
          outType = 'application/pdf';
        }

        const typed = outType && outType !== blob.type ? new Blob([blob], { type: outType }) : blob;
        objectUrl = URL.createObjectURL(typed);
        setUrl(objectUrl);
      } catch (loadError: unknown) {
        if (loadError instanceof Error && loadError.name === 'AbortError') {
          return;
        }
        console.error('Error loading preview:', loadError);
        setError(labels.error);
      } finally {
        setLoading(false);
      }
    };

    loadMedia();

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file.path, projectId, kind, labels.error]);

  const renderMedia = () => {
    if (!url) return null;
    switch (kind) {
      case 'image':
        return (
          <img
            src={url}
            alt={file.name}
            className="max-h-full max-w-full object-contain"
          />
        );
      case 'pdf':
        // Not sandboxed on purpose: the browser's built-in PDF viewer refuses to
        // load inside a sandboxed frame (any `sandbox` value yields a broken
        // viewer). Script execution is instead prevented upstream by validating
        // the PDF magic bytes and pinning the blob's MIME type to application/pdf.
        return <iframe src={url} title={file.name} className="h-full w-full border-0 bg-white" />;
      case 'video':
        return (
          <video src={url} controls className="max-h-full max-w-full" autoPlay={false}>
            {labels.error}
          </video>
        );
      case 'audio':
        return (
          <div className="flex w-full max-w-xl flex-col items-center gap-4 px-6">
            <p className="max-w-full truncate text-sm text-muted-foreground">{file.name}</p>
            <audio src={url} controls className="w-full">
              {labels.error}
            </audio>
          </div>
        );
      default:
        return null;
    }
  };

  const previewBody = (
    <div className="relative flex h-full w-full flex-col items-center justify-center bg-muted/30 p-2">
      {loading && (
        <div className="text-sm text-muted-foreground">{labels.loading}</div>
      )}

      {!loading && url && renderMedia()}

      {!loading && !url && (
        <div className="flex flex-col items-center gap-3 p-8 text-center text-muted-foreground">
          <p className="text-sm">{error || labels.error}</p>
          <p className="break-all text-xs">{file.path}</p>
        </div>
      )}
    </div>
  );

  const headerActions = (
    <div className="flex shrink-0 items-center gap-0.5">
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          title={labels.openInNewTab}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
      {!isSidebar && (
        <button
          type="button"
          onClick={onToggleFullscreen}
          className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
          title={isFullscreen ? labels.exitFullscreen : labels.fullscreen}
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
      )}
      <button
        type="button"
        onClick={onClose}
        className="flex items-center justify-center rounded-md p-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
        title={labels.close}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );

  const header = (
    <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <h3 className="truncate text-sm font-medium text-gray-900 dark:text-white">{file.name}</h3>
      </div>
      {headerActions}
    </div>
  );

  if (isSidebar) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        {header}
        {previewBody}
      </div>
    );
  }

  const containerClassName = isFullscreen
    ? 'fixed inset-0 z-[9999] bg-background flex flex-col'
    : 'fixed inset-0 z-[9999] md:bg-black/50 md:flex md:items-center md:justify-center md:p-4';

  const innerClassName = isFullscreen
    ? 'bg-background flex flex-col w-full h-full'
    : 'bg-background shadow-2xl flex flex-col w-full h-full md:rounded-lg md:shadow-2xl md:w-full md:max-w-6xl md:h-[80vh] md:max-h-[80vh]';

  return (
    <div className={containerClassName}>
      <div className={innerClassName}>
        {header}
        {previewBody}
      </div>
    </div>
  );
}
