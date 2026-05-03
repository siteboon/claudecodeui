import { useTranslation } from 'react-i18next';
import { X, Download } from 'lucide-react';
import type { ArtifactViewerProps } from './types';

export default function ArtifactViewer({ artifact, onClose, onVersionSelect, onExport }: ArtifactViewerProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{artifact.title}</span>
          {artifact.language && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{artifact.language}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {onExport && (
            <button type="button" aria-label={t('artifacts.export')} onClick={onExport} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Download className="h-4 w-4" />
            </button>
          )}
          <button type="button" aria-label={t('artifacts.close')} onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Version selector */}
      {artifact.versions.length > 0 && (
        <div className="flex gap-1 border-b border-border px-4 py-1.5 overflow-x-auto">
          {artifact.versions.map((version, i) => (
            <button
              key={version.id}
              type="button"
              onClick={() => onVersionSelect?.(version.id)}
              className="shrink-0 rounded px-2 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              v{i + 1}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {artifact.type === 'code' ? (
          <pre className="rounded-lg bg-code-bg p-4 text-sm overflow-x-auto">
            <code className={artifact.language ? `language-${artifact.language}` : ''}>
              {artifact.content}
            </code>
          </pre>
        ) : artifact.type === 'document' ? (
          <div data-testid="artifact-markdown" className="prose dark:prose-invert max-w-none text-sm">
            {artifact.content}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div dangerouslySetInnerHTML={{ __html: artifact.content }} />
          </div>
        )}
      </div>
    </div>
  );
}
