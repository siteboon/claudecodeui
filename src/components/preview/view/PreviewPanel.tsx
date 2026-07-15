import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ExternalLink, Radar, Container, Globe } from 'lucide-react';

import { authenticatedFetch } from '../../../utils/api';
import { Button } from '../../../shared/view/ui/Button';
import { Input } from '../../../shared/view/ui/Input';
import type { Project } from '../../../types/app';

type PreviewPanelProps = {
  selectedProject: Project | null;
  isVisible: boolean;
  requestedPort?: number | null;
  onPortConsumed?: () => void;
};

type DetectedPort = {
  port: number;
  source: 'process' | 'docker';
  name: string;
};

export default function PreviewPanel({ isVisible, requestedPort, onPortConsumed }: PreviewPanelProps) {
  const [portInput, setPortInput] = useState('');
  const [activePort, setActivePort] = useState<number | null>(null);
  const [ports, setPorts] = useState<DetectedPort[]>([]);
  const [scanning, setScanning] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);

  // Mint the preview cookie once; the proxied iframe authenticates with it.
  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/preview/session', { method: 'POST' })
      .then((r) => r.json())
      .then(() => {
        if (!cancelled) setSessionReady(true);
      })
      .catch(() => {
        if (!cancelled) setSessionReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scanPorts = useCallback(async () => {
    setScanning(true);
    try {
      const res = await authenticatedFetch('/api/preview/ports');
      const data = await res.json();
      setPorts(Array.isArray(data.ports) ? data.ports : []);
    } catch {
      setPorts([]);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    if (isVisible && ports.length === 0) {
      void scanPorts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  const openPort = useCallback((port: number) => {
    setActivePort(port);
    setPortInput(String(port));
    setIframeKey((k) => k + 1);
  }, []);

  const submitPort = useCallback(() => {
    const p = Number(portInput.trim());
    if (Number.isInteger(p) && p >= 1 && p <= 65535) openPort(p);
  }, [portInput, openPort]);

  // A port picked from the Docker tab opens here.
  useEffect(() => {
    if (requestedPort && requestedPort !== activePort) {
      openPort(requestedPort);
      onPortConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPort]);

  const previewUrl = activePort ? `/preview/${activePort}/` : '';

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Port (e.g. 3000)"
            value={portInput}
            onChange={(e) => setPortInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitPort()}
            className="h-8 w-32"
          />
          <Button size="sm" variant="secondary" onClick={submitPort} className="h-8">
            Open
          </Button>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={scanPorts}
          disabled={scanning}
          className="h-8"
          title="Scan for listening ports"
        >
          <Radar className={scanning ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Scan</span>
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIframeKey((k) => k + 1)}
            disabled={!activePort}
            className="h-8 w-8 p-0"
            title="Reload"
          >
            <RefreshCw />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => activePort && window.open(previewUrl, '_blank')}
            disabled={!activePort}
            className="h-8 w-8 p-0"
            title="Open in new tab"
          >
            <ExternalLink />
          </Button>
        </div>
      </div>

      {/* Detected ports */}
      {ports.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
          {ports.map((p) => (
            <button
              key={`${p.source}-${p.port}`}
              onClick={() => openPort(p.port)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
                activePort === p.port
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border hover:bg-muted'
              }`}
              title={`${p.name} (${p.source})`}
            >
              {p.source === 'docker' ? (
                <Container className="h-3 w-3" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
              )}
              <span className="font-mono font-medium">{p.port}</span>
              <span className="max-w-24 truncate text-muted-foreground">{p.name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Preview surface */}
      <div className="relative min-h-0 flex-1 bg-white dark:bg-neutral-900">
        {!activePort ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <Globe className="h-10 w-10 opacity-40" />
            <p className="text-sm">
              Enter a port or pick a detected one to preview a local server here.
            </p>
            <p className="max-w-sm text-xs opacity-70">
              Your project&apos;s dev server (e.g. <span className="font-mono">localhost:3000</span>) is
              proxied through CloudCLI, so it&apos;s reachable from your phone too.
            </p>
          </div>
        ) : !sessionReady ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Preparing preview…
          </div>
        ) : (
          <iframe
            key={iframeKey}
            src={previewUrl}
            title={`Preview localhost:${activePort}`}
            className="h-full w-full border-0"
          />
        )}
      </div>
    </div>
  );
}
