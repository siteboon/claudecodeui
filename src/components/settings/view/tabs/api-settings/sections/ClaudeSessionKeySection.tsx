import { CheckCircle2, ChevronDown, ChevronUp, Eye, EyeOff, ExternalLink, KeyRound, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../../utils/api';

const STEPS = [
  {
    n: 1,
    label: 'Open claude.ai',
    detail: null,
    action: { label: 'Open claude.ai', href: 'https://claude.ai' },
  },
  {
    n: 2,
    label: 'Open DevTools',
    detail: 'Press F12  (Windows/Linux) or ⌘⌥I (Mac)',
    action: null,
  },
  {
    n: 3,
    label: 'Go to Application → Cookies',
    detail: (
      <>
        Select the <span className="font-mono text-[11px] bg-muted px-1 rounded">Application</span> tab,
        then expand <span className="font-mono text-[11px] bg-muted px-1 rounded">Cookies</span> →{' '}
        <span className="font-mono text-[11px] bg-muted px-1 rounded">https://claude.ai</span>
      </>
    ),
    action: null,
  },
  {
    n: 4,
    label: 'Copy the sessionKey value',
    detail: (
      <>
        Find the cookie named <span className="font-mono text-[11px] bg-muted px-1 rounded">sessionKey</span>,
        double-click its value, and copy it.
      </>
    ),
    action: null,
  },
];

export default function ClaudeSessionKeySection() {
  const { t } = useTranslation('settings');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await authenticatedFetch('/api/user/claude-session-key');
      const body = await res.json() as { success: boolean; hasKey: boolean };
      if (body.success) setHasKey(body.hasKey);
    } catch {
      setHasKey(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleSave = async () => {
    if (!inputValue.trim()) return;
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await authenticatedFetch('/api/user/claude-session-key', {
        method: 'PUT',
        body: JSON.stringify({ sessionKey: inputValue.trim() }),
      });
      if (res.ok) {
        setHasKey(true);
        setShowForm(false);
        setShowGuide(false);
        setInputValue('');
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t('claudeSessionKey.confirmDelete', { defaultValue: 'Remove the session key?' }))) return;
    try {
      await authenticatedFetch('/api/user/claude-session-key', { method: 'DELETE' });
      setHasKey(false);
      setShowForm(false);
      setInputValue('');
    } catch {
      // silent
    }
  };

  if (hasKey === null) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">
            {t('claudeSessionKey.title', { defaultValue: 'Claude.ai Session Key' })}
          </h3>
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {hasKey && !showForm && (
            <Button size="sm" variant="outline" onClick={() => { setShowForm(true); setShowGuide(false); }}>
              {t('claudeSessionKey.update', { defaultValue: 'Update' })}
            </Button>
          )}
          {!hasKey && !showForm && (
            <Button size="sm" onClick={() => { setShowForm(true); setShowGuide(true); }}>
              {t('claudeSessionKey.addButton', { defaultValue: 'Set up' })}
            </Button>
          )}
          {hasKey && (
            <Button size="sm" variant="ghost" onClick={handleDelete} title="Remove key">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        {t('claudeSessionKey.description', {
          defaultValue:
            'Shows your Claude.ai subscription usage next to the context counter in the chat composer. Read-only — never used for API calls.',
        })}
      </p>

      {hasKey && !showForm && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
          {t('claudeSessionKey.keySet', { defaultValue: 'Session key is configured' })}
        </div>
      )}

      {showForm && (
        <div className="space-y-3 rounded-lg border bg-card p-4">

          {/* Collapsible how-to guide */}
          <button
            type="button"
            onClick={() => setShowGuide((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-medium text-foreground"
          >
            <span>How to get your session key</span>
            {showGuide
              ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
              : <ChevronDown className="h-4 w-4 text-muted-foreground" />
            }
          </button>

          {showGuide && (
            <ol className="space-y-3 border-t border-border/50 pt-3">
              {STEPS.map((step) => (
                <li key={step.n} className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                    {step.n}
                  </span>
                  <div className="min-w-0 space-y-1 pt-0.5">
                    <p className="text-sm font-medium leading-tight">{step.label}</p>
                    {step.detail && (
                      <p className="text-xs text-muted-foreground leading-relaxed">{step.detail}</p>
                    )}
                    {step.action && (
                      <a
                        href={step.action.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {step.action.label}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {/* Key input */}
          <div className="relative">
            <Input
              type={showInput ? 'text' : 'password'}
              placeholder="Paste your sessionKey cookie value here"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
              className="pr-10 font-mono text-xs"
              autoComplete="off"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowInput((v) => !v)}
              aria-label={showInput ? 'Hide key' : 'Show key'}
              className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
            >
              {showInput ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          {saveStatus === 'error' && (
            <p className="text-xs text-destructive">
              {t('claudeSessionKey.saveError', { defaultValue: 'Failed to save. Please try again.' })}
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={saving || !inputValue.trim()}>
              {saving ? 'Saving…' : 'Save key'}
            </Button>
            <Button
              variant="outline"
              onClick={() => { setShowForm(false); setShowGuide(false); setInputValue(''); setSaveStatus('idle'); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
