import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Play, Square, RotateCw, ScrollText, X, Container, RefreshCw, ExternalLink } from 'lucide-react';

import { authenticatedFetch } from '../../../utils/api';
import { Button } from '../../../shared/view/ui/Button';
import type { Project } from '../../../types/app';

type DockerPanelProps = {
  selectedProject: Project | null;
  isVisible: boolean;
  onOpenPreview?: (port: number) => void;
};

type DockerAction = 'up' | 'down' | 'stop' | 'restart' | 'logs';

type ServicePort = { published: number; target: number };
type DockerService = {
  name: string;
  image: string | null;
  state: string;
  ports: ServicePort[];
};

function isRunning(state: string) {
  return /run|up|healthy/i.test(state);
}

export default function DockerPanel({ selectedProject, isVisible, onOpenPreview }: DockerPanelProps) {
  const [services, setServices] = useState<DockerService[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasCompose, setHasCompose] = useState(true);
  const [dockerAvailable, setDockerAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${action}:${service||'*'}`
  const [logs, setLogs] = useState<{ title: string; body: string } | null>(null);

  const projectPath = selectedProject?.fullPath || selectedProject?.path || '';

  const loadServices = useCallback(async () => {
    if (!projectPath) {
      setServices([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await authenticatedFetch(
        `/api/preview/docker/services?projectPath=${encodeURIComponent(projectPath)}`,
      );
      const data = await res.json();
      setServices(Array.isArray(data.services) ? data.services : []);
      setHasCompose(data.hasCompose !== false);
      setDockerAvailable(data.dockerAvailable !== false);
      setError(data.error || null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (isVisible) void loadServices();
  }, [isVisible, loadServices]);

  const run = useCallback(
    async (action: DockerAction, service?: string) => {
      if (!projectPath) return;
      const key = `${action}:${service || '*'}`;
      setBusy(key);
      try {
        const res = await authenticatedFetch('/api/preview/docker', {
          method: 'POST',
          body: JSON.stringify({ action, projectPath, service }),
        });
        const data = await res.json();
        if (action === 'logs') {
          const body = [data.stdout, data.stderr].filter(Boolean).join('\n').trim();
          setLogs({ title: service ? `logs · ${service}` : 'logs', body: body || '(no output)' });
        } else if (data.error) {
          setError(data.error);
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
        if (action !== 'logs') void loadServices();
      }
    },
    [projectPath, loadServices],
  );

  const anyRunning = services.some((s) => isRunning(s.state));

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header / global actions */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2">
        <Container className="mr-1 h-4 w-4 text-muted-foreground" />
        <span className="mr-auto text-sm font-medium">Docker Compose</span>
        <Button size="sm" variant="ghost" onClick={loadServices} disabled={loading} className="h-8 w-8 p-0" title="Refresh">
          <RefreshCw className={loading ? 'animate-spin' : ''} />
        </Button>
        <Button size="sm" variant="secondary" onClick={() => run('up')} disabled={!!busy || !hasCompose} className="h-8">
          <Play /> up -d
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => run('down')}
          disabled={!!busy || !anyRunning}
          className="h-8"
        >
          <Square /> down
        </Button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto">
        {!projectPath ? (
          <EmptyState text="Select a project to see its docker services." />
        ) : !dockerAvailable ? (
          <EmptyState text="Docker CLI not detected on this machine." tone="warn" />
        ) : !hasCompose ? (
          <EmptyState text="No docker-compose file found in this project." />
        ) : services.length === 0 ? (
          <EmptyState text={loading ? 'Loading services…' : error || 'No services defined.'} tone={error ? 'warn' : undefined} />
        ) : (
          <ul className="divide-y divide-border">
            {services.map((svc) => {
              const running = isRunning(svc.state);
              return (
                <li key={svc.name} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${running ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
                    title={svc.state}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{svc.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{svc.state}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {svc.image && (
                        <span className="truncate font-mono text-[11px] text-muted-foreground">{svc.image}</span>
                      )}
                      {svc.ports.map((p) => (
                        <button
                          key={p.published}
                          onClick={() => onOpenPreview?.(p.published)}
                          disabled={!running}
                          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-primary hover:text-primary disabled:opacity-40 disabled:hover:border-border disabled:hover:text-inherit"
                          title={running ? `Preview localhost:${p.published}` : 'Service is not running'}
                        >
                          {p.published}
                          {running && <ExternalLink className="h-3 w-3" />}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <IconBtn title="restart" busy={busy === `restart:${svc.name}`} onClick={() => run('restart', svc.name)}>
                      <RotateCw />
                    </IconBtn>
                    <IconBtn title="logs" busy={busy === `logs:${svc.name}`} onClick={() => run('logs', svc.name)}>
                      <ScrollText />
                    </IconBtn>
                    {running ? (
                      <IconBtn title="stop" busy={busy === `stop:${svc.name}`} onClick={() => run('stop', svc.name)}>
                        <Square />
                      </IconBtn>
                    ) : (
                      <IconBtn title="start" busy={busy === `up:${svc.name}`} onClick={() => run('up', svc.name)}>
                        <Play />
                      </IconBtn>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Logs drawer */}
      {logs && (
        <div className="flex max-h-[45%] flex-col border-t border-border bg-muted/30">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <span className="text-xs font-medium">{logs.title}</span>
            <Button size="sm" variant="ghost" onClick={() => setLogs(null)} className="ml-auto h-6 w-6 p-0" title="Close">
              <X />
            </Button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed text-foreground">
            {logs.body}
          </pre>
        </div>
      )}
    </div>
  );
}

function EmptyState({ text, tone }: { text: string; tone?: 'warn' }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <Container className="h-10 w-10 opacity-30" />
      <p className={`text-sm ${tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
        {text}
      </p>
    </div>
  );
}

function IconBtn({
  children,
  title,
  busy,
  onClick,
}: {
  children: ReactNode;
  title: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} disabled={busy} className="h-8 w-8 p-0" title={title}>
      {children}
    </Button>
  );
}
