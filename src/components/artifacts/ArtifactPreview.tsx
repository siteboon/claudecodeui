import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, ExternalLink } from 'lucide-react';
import type { DetectedArtifactType } from './ArtifactDetector';

interface ArtifactPreviewProps {
  type: DetectedArtifactType;
  content: string;
  onCopy?: () => void;
  onDownload?: () => void;
  onOpenNewTab?: () => void;
}

function buildSrcdoc(type: DetectedArtifactType, content: string): string {
  switch (type) {
    case 'html':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui,sans-serif;}</style></head><body>${content}</body></html>`;
    case 'svg':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;}</style></head><body>${content}</body></html>`;
    case 'react':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><script src="https://unpkg.com/react@18/umd/react.development.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script><script src="https://unpkg.com/@babel/standalone/babel.min.js"></script></head><body><div id="root"></div><script type="text/babel">${content}\nconst root = ReactDOM.createRoot(document.getElementById('root'));\nif (typeof App !== 'undefined') root.render(React.createElement(App));</script></body></html>`;
    case 'mermaid':
      return `<!DOCTYPE html><html><head><meta charset="utf-8"><script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script></head><body><pre class="mermaid">${content}</pre><script>mermaid.initialize({startOnLoad:true});</script></body></html>`;
  }
}

export default function ArtifactPreview({ type, content, onCopy, onDownload, onOpenNewTab }: ArtifactPreviewProps) {
  const { t } = useTranslation();
  const srcdoc = useMemo(() => buildSrcdoc(type, content), [type, content]);

  return (
    <div className="flex h-full flex-col">
      {/* Action bar */}
      <div className="flex items-center justify-end gap-1 border-b border-border px-2 py-1">
        {onCopy && (
          <button type="button" aria-label={t('artifacts.copy')} onClick={onCopy} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <Copy className="h-4 w-4" />
          </button>
        )}
        {onDownload && (
          <button type="button" aria-label={t('artifacts.download')} onClick={onDownload} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <Download className="h-4 w-4" />
          </button>
        )}
        {onOpenNewTab && (
          <button type="button" aria-label={t('artifacts.openNewTab')} onClick={onOpenNewTab} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Sandboxed preview */}
      <iframe
        className="flex-1 w-full border-0"
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        title="Artifact preview"
      />
    </div>
  );
}
