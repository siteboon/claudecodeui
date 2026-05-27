import { Eye, EyeOff, KeyRound, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../../../../../../shared/view/ui';
import { authenticatedFetch } from '../../../../../../utils/api';

export default function ClaudeSessionKeySection() {
  const { t } = useTranslation('settings');
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [showForm, setShowForm] = useState(false);
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
        setInputValue('');
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
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
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          <h3 className="text-lg font-semibold">{t('claudeSessionKey.title', { defaultValue: 'Claude.ai Session Key' })}</h3>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'saved' && (
            <span className="text-xs text-green-600">{t('claudeSessionKey.saved', { defaultValue: 'Saved' })}</span>
          )}
          {hasKey && !showForm && (
            <Button size="sm" variant="outline" onClick={() => setShowForm(true)}>
              {t('claudeSessionKey.update', { defaultValue: 'Update' })}
            </Button>
          )}
          {!hasKey && !showForm && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              {t('claudeSessionKey.addButton', { defaultValue: 'Add Key' })}
            </Button>
          )}
          {hasKey && (
            <Button size="sm" variant="ghost" onClick={handleDelete} title={t('claudeSessionKey.delete', { defaultValue: 'Remove key' })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {t('claudeSessionKey.description', { defaultValue: 'Enables usage tracking displayed next to the token counter in the chat composer. Only used for Claude provider sessions.' })}
      </p>

      {hasKey && !showForm && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          {t('claudeSessionKey.keySet', { defaultValue: 'Session key is configured' })}
        </div>
      )}

      {showForm && (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="relative">
            <Input
              type={showInput ? 'text' : 'password'}
              placeholder={t('claudeSessionKey.placeholder', { defaultValue: 'Paste your sessionKey cookie value' })}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="pr-10 font-mono text-xs"
              autoComplete="off"
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
              {saving ? t('claudeSessionKey.saving', { defaultValue: 'Saving…' }) : t('claudeSessionKey.save', { defaultValue: 'Save' })}
            </Button>
            <Button variant="outline" onClick={() => { setShowForm(false); setInputValue(''); setSaveStatus('idle'); }}>
              {t('claudeSessionKey.cancel', { defaultValue: 'Cancel' })}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {t('claudeSessionKey.howToGetHint', { defaultValue: 'Find your sessionKey in browser DevTools → Application → Cookies → claude.ai' })}
          </p>
        </div>
      )}
    </div>
  );
}
