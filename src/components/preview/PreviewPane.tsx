import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Globe } from 'lucide-react';

type DevicePreset = {
  id: 'iphone-se' | 'iphone-pro' | 'ipad' | 'desktop' | 'fill';
  label: string;
  width: number | 'fill';
  height: number | 'fill';
};

const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'fill',       label: 'Fill',       width: 'fill', height: 'fill' },
  { id: 'iphone-se',  label: 'iPhone SE',  width: 375,    height: 667 },
  { id: 'iphone-pro', label: 'iPhone Pro', width: 430,    height: 932 },
  { id: 'ipad',       label: 'iPad',       width: 820,    height: 1180 },
  { id: 'desktop',    label: 'Desktop',    width: 1280,   height: 800 },
];

const DEFAULT_PORT = '3000';
const DEFAULT_PATH = '/';

export type PreviewPaneProps = {
  /** Container height control. Modal contexts use fullscreen; panel fills its slot. */
  variant?: 'panel' | 'modal';
  /** Optional className for wrapper */
  className?: string;
};

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

export default function PreviewPane({ variant = 'panel', className = '' }: PreviewPaneProps) {
  const [portInput, setPortInput] = useState<string>(DEFAULT_PORT);
  const [pathInput, setPathInput] = useState<string>(DEFAULT_PATH);
  const [activePort, setActivePort] = useState<string>(DEFAULT_PORT);
  const [activePath, setActivePath] = useState<string>(DEFAULT_PATH);
  const [preset, setPreset] = useState<DevicePreset['id']>('fill');
  const [reloadKey, setReloadKey] = useState<number>(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const src = useMemo(() => `/preview/${activePort}${normalizePath(activePath)}`, [activePort, activePath]);

  const onSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmedPort = portInput.trim();
    const trimmedPath = pathInput.trim() || '/';
    if (!/^\d{2,5}$/.test(trimmedPort)) return;
    setActivePort(trimmedPort);
    setActivePath(trimmedPath);
    setReloadKey((prev) => prev + 1);
  }, [portInput, pathInput]);

  const onRefresh = useCallback(() => {
    setReloadKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    // When the port/path/preset changes, sync the input values back so the
    // URL bar always reflects what's showing.
    setPortInput(activePort);
    setPathInput(activePath);
  }, [activePort, activePath]);

  const frameStyle = useMemo(() => {
    const p = DEVICE_PRESETS.find((preset) => preset.id === preset.id) || DEVICE_PRESETS[0];
    const selected = DEVICE_PRESETS.find((d) => d.id === preset) || DEVICE_PRESETS[0];
    if (selected.id === 'fill') return { width: '100%', height: '100%' } as const;
    return {
      width: `${selected.width}px`,
      height: `${selected.height}px`,
      maxWidth: '100%',
      maxHeight: '100%',
    } as const;
    void p;
  }, [preset]);

  const rootHeight = variant === 'modal' ? 'h-[100dvh]' : 'h-full';

  return (
    <div
      data-accent="mint"
      className={`flex min-h-0 flex-col ${rootHeight} w-full overflow-hidden ${className}`.trim()}
    >
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-center gap-2 border-b border-midnight-border px-3 py-2"
        style={{ background: 'var(--midnight-surface-1)' }}
      >
        <div className="flex items-center gap-2 text-midnight-text2">
          <Globe className="h-4 w-4" aria-hidden="true" />
          <span className="text-xs uppercase tracking-wider">localhost:</span>
        </div>
        <input
          aria-label="Port"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={portInput}
          onChange={(e) => setPortInput(e.target.value)}
          className="ds-input mobile-touch-target w-24"
          placeholder="3000"
        />
        <input
          aria-label="Path"
          type="text"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          className="ds-input mobile-touch-target min-w-0 flex-1"
          placeholder="/"
        />
        <select
          aria-label="Device size"
          value={preset}
          onChange={(e) => setPreset(e.target.value as DevicePreset['id'])}
          className="ds-input mobile-touch-target w-auto"
        >
          {DEVICE_PRESETS.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
        <button
          type="submit"
          aria-label="Load preview"
          className="btn btn-pill-light mobile-touch-target"
        >
          Go
        </button>
        <button
          type="button"
          aria-label="Refresh preview"
          onClick={onRefresh}
          className="btn btn-secondary mobile-touch-target"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </button>
        <a
          href={src}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Open preview in new tab"
          className="btn btn-ghost mobile-touch-target"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
      </form>

      <div
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3"
        style={{ background: 'var(--midnight-surface-0)' }}
      >
        <div
          className="ds-tile-plain overflow-hidden"
          style={{
            ...frameStyle,
            padding: 0,
          }}
        >
          <iframe
            ref={iframeRef}
            key={reloadKey}
            title="Preview"
            src={src}
            className="block h-full w-full border-0 bg-white"
            sandbox="allow-forms allow-modals allow-popups allow-presentation allow-same-origin allow-scripts allow-downloads"
          />
        </div>
      </div>
    </div>
  );
}
