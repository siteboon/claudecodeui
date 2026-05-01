import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Code, Image } from 'lucide-react';

interface MermaidDiagramProps {
  source: string;
}

/**
 * Renders a mermaid diagram from source text.
 * Mermaid is loaded lazily to keep the main bundle small.
 */
export default function MermaidDiagram({ source }: MermaidDiagramProps) {
  const containerId = `mermaid-${useId().replace(/:/g, '')}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'diagram' | 'source'>('diagram');
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSourceRef = useRef<string>('');

  const renderDiagram = useCallback(async (src: string) => {
    try {
      const mermaid = (await import('mermaid')).default;
      mermaid.initialize({
        startOnLoad: false,
        theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        securityLevel: 'loose',
      });
      const { svg: renderedSvg } = await mermaid.render(containerId, src);
      setSvg(renderedSvg);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render diagram');
      setSvg(null);
    } finally {
      setLoading(false);
    }
  }, [containerId]);

  useEffect(() => {
    // Debounce re-renders (300ms) during streaming
    if (source === lastSourceRef.current) return;
    lastSourceRef.current = source;

    if (renderTimerRef.current) {
      clearTimeout(renderTimerRef.current);
    }

    setLoading(true);
    renderTimerRef.current = setTimeout(() => {
      renderDiagram(source);
    }, 300);

    return () => {
      if (renderTimerRef.current) {
        clearTimeout(renderTimerRef.current);
      }
    };
  }, [source, renderDiagram]);

  const toggleView = () => setView((v) => (v === 'diagram' ? 'source' : 'diagram'));

  return (
    <div className="group relative my-2 rounded-lg border border-border bg-background">
      {/* Toggle button */}
      <button
        type="button"
        onClick={toggleView}
        className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-muted/80 px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
      >
        {view === 'diagram' ? (
          <>
            <Code className="h-3 w-3" />
            Source
          </>
        ) : (
          <>
            <Image className="h-3 w-3" />
            Diagram
          </>
        )}
      </button>

      {view === 'diagram' ? (
        <div ref={containerRef} className="overflow-auto p-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              Rendering diagram...
            </div>
          )}
          {error && !loading && (
            <div className="text-sm text-red-500 dark:text-red-400">
              Failed to render diagram. Showing source instead.
              <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-xs text-muted-foreground">
                {source}
              </pre>
            </div>
          )}
          {svg && !loading && (
            <div
              className="flex justify-center [&>svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </div>
      ) : (
        <pre className="overflow-auto p-4 text-sm text-muted-foreground">
          {source}
        </pre>
      )}
    </div>
  );
}
