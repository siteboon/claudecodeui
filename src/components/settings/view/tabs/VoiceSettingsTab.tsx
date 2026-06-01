import { Keyboard, Mic, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../../../shared/view/ui';

export type ShortcutConfig = {
  key: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
};

export type WhisperSettings = {
  url: string;
  shortcut: ShortcutConfig;
};

const WHISPER_SETTINGS_KEY = 'whisper-settings';

export const DEFAULT_SHORTCUT: ShortcutConfig = {
  key: 'M',
  ctrl: true,
  shift: true,
  alt: false,
  meta: false,
};

const DEFAULTS: WhisperSettings = {
  url: 'http://192.168.1.16:8300',
  shortcut: DEFAULT_SHORTCUT,
};

export function formatShortcut(s: ShortcutConfig): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push('Ctrl');
  if (s.meta) parts.push('⌘');
  if (s.alt) parts.push('Alt');
  if (s.shift) parts.push('Shift');
  parts.push(s.key.length === 1 ? s.key.toUpperCase() : s.key);
  return parts.join('+');
}

export function matchesShortcut(event: KeyboardEvent, s: ShortcutConfig): boolean {
  const MODIFIERS = ['Control', 'Shift', 'Alt', 'Meta'];
  if (MODIFIERS.includes(event.key)) return false;
  return (
    event.ctrlKey === s.ctrl &&
    event.shiftKey === s.shift &&
    event.altKey === s.alt &&
    event.metaKey === s.meta &&
    event.key.toUpperCase() === s.key.toUpperCase()
  );
}

export function loadWhisperSettings(): WhisperSettings {
  try {
    const raw = localStorage.getItem(WHISPER_SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS, shortcut: { ...DEFAULT_SHORTCUT } };
    const parsed = JSON.parse(raw) as Partial<WhisperSettings>;
    return {
      ...DEFAULTS,
      ...parsed,
      shortcut: parsed.shortcut ? { ...DEFAULT_SHORTCUT, ...parsed.shortcut } : { ...DEFAULT_SHORTCUT },
    };
  } catch {
    return { ...DEFAULTS, shortcut: { ...DEFAULT_SHORTCUT } };
  }
}

function ShortcutRecorder({
  value,
  onChange,
}: {
  value: ShortcutConfig;
  onChange: (s: ShortcutConfig) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<ShortcutConfig | null>(null);

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const MODIFIERS = ['Control', 'Shift', 'Alt', 'Meta'];
      if (MODIFIERS.includes(e.key)) return;

      const newShortcut: ShortcutConfig = {
        key: e.key,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey,
      };
      setPreview(newShortcut);
      setRecording(false);
      onChange(newShortcut);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setRecording(false);
        setPreview(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('keyup', handleKeyUp, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('keyup', handleKeyUp, { capture: true });
    };
  }, [recording, onChange]);

  const displayed = preview ?? value;

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm min-w-[160px] ${
          recording
            ? 'border-primary bg-primary/5 text-primary animate-pulse'
            : 'border-input bg-background text-foreground'
        }`}
      >
        <Keyboard className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="font-mono">
          {recording ? 'Press shortcut…' : formatShortcut(displayed)}
        </span>
      </div>
      <Button
        variant="outline"
        className="text-sm"
        onClick={() => {
          setPreview(null);
          setRecording(true);
        }}
        disabled={recording}
      >
        {recording ? 'Listening…' : 'Change'}
      </Button>
      {recording && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => { setRecording(false); setPreview(null); }}
        >
          Cancel (Esc)
        </button>
      )}
    </div>
  );
}

export default function VoiceSettingsTab() {
  const [settings, setSettings] = useState<WhisperSettings>(loadWhisperSettings);
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [testInfo, setTestInfo] = useState<string | null>(null);

  const handleSave = () => {
    localStorage.setItem(WHISPER_SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTest = async () => {
    setTestStatus('idle');
    setTestInfo('checking…');
    try {
      const [hRes, cRes] = await Promise.all([
        fetch(`${settings.url}/voice/healthz`),
        fetch(`${settings.url}/voice/config`),
      ]);
      if (!hRes.ok) throw new Error(`HTTP ${hRes.status}`);
      const h = await hRes.json() as Record<string, unknown>;
      const c = cRes.ok ? await cRes.json() as Record<string, unknown> : {};
      const model = (h.stt_model as string) || '?';
      const lang = (c.stt_language as string) || '?';
      const vad = c.vad_filter != null ? String(c.vad_filter) : '?';
      setTestStatus('ok');
      setTestInfo(`online · model: ${model} · language: ${lang} · VAD: ${vad}`);
    } catch (e) {
      setTestStatus('error');
      setTestInfo(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Mic className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-medium text-foreground">Voice / Whisper Dictation</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Dictation uses WebSocket to stream audio to the voice service (faster-whisper on GPU).
          Audio is sent directly from your browser to the service.
        </p>
      </div>

      <div className="space-y-4 bg-card border border-border rounded-lg p-4">
        <h4 className="font-medium text-foreground">Voice Service URL</h4>

        <div className="space-y-2">
          <label className="block text-sm font-medium text-foreground">Base URL</label>
          <input
            type="url"
            value={settings.url}
            onChange={(e) => { setSettings((p) => ({ ...p, url: e.target.value })); setSaved(false); }}
            placeholder="http://192.168.1.16:8300"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            WebSocket connects to <code className="text-xs bg-muted px-1 rounded">{settings.url.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://')}/voice/stt</code>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleTest} className="text-sm">
            Test connection
          </Button>
          {testInfo && (
            <span className={`text-xs ${testStatus === 'ok' ? 'text-green-600 dark:text-green-400' : testStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
              {testInfo}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 bg-card border border-border rounded-lg p-4">
        <h4 className="font-medium text-foreground">Keyboard Shortcut</h4>
        <p className="text-sm text-muted-foreground">
          Global shortcut to start/stop dictation from anywhere in the app.
        </p>
        <ShortcutRecorder
          value={settings.shortcut}
          onChange={(s) => { setSettings((p) => ({ ...p, shortcut: s })); setSaved(false); }}
        />
      </div>

      <div className="space-y-3 bg-muted/30 border border-border rounded-lg p-4">
        <h4 className="text-sm font-medium text-foreground">Language, model & VAD</h4>
        <p className="text-sm text-muted-foreground">
          These are configured on the voice service itself, not per-request. Change them via:
        </p>
        <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
          <li>Admin panel → Voice → STT settings</li>
          <li>
            <code className="text-xs bg-muted px-1 rounded">POST {settings.url}/voice/config</code> with <code className="text-xs bg-muted px-1 rounded">{'{"stt_model":"small","stt_language":"pl","vad_filter":true}'}</code>
          </li>
        </ul>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} className="flex items-center gap-2">
          <Save className="w-4 h-4" />
          Save
        </Button>
        {saved && (
          <span className="text-sm text-muted-foreground animate-in fade-in">Saved</span>
        )}
      </div>
    </div>
  );
}
