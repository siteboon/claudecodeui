import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import { Button, Input } from '@/shared/ui';

/** Rendered by AccountContent to configure Codex API access owned by this CloudCLI installation. */
export default function CodexApiConnection({ onSaved }: { onSaved?: () => void }) {
  const { t } = useTranslation('settings');
  // Keep editable fields and the server's key-presence descriptor; saved keys are never returned.
  const [connection, setConnection] = useState({ provider: 'custom-api', baseUrl: '', apiKey: '', hasApiKey: false });
  // Prevent edits while loading/saving and report the result of the latest configuration request.
  const [status, setStatus] = useState({ busy: true, message: '', error: false });

  useEffect(() => {
    let active = true;
    void api.providers.codexApiConnection()
      .then(response => readApiJson<{ data: { provider: string; baseUrl: string; hasApiKey: boolean } }>(response))
      .then(({ data }) => {
        if (active) {
          setConnection({ ...data, apiKey: '' });
          setStatus({ busy: false, message: '', error: false });
        }
      }).catch((error: unknown) => {
        if (active) setStatus({ busy: false, message: error instanceof Error ? error.message : t('agents.codexApi.failed'), error: true });
      });
    return () => { active = false; };
  }, [t]);

  const persist = async (remove = false) => {
    setStatus({ busy: true, message: '', error: false });
    try {
      const response = remove
        ? await api.providers.clearCodexApiConnection()
        : await api.providers.saveCodexApiConnection({ provider: connection.provider, baseUrl: connection.baseUrl, apiKey: connection.apiKey });
      const { data } = await readApiJson<{ data: { provider: string; baseUrl: string; hasApiKey: boolean } }>(response);
      setConnection({ ...data, apiKey: '' });
      setStatus({ busy: false, message: t(remove ? 'agents.codexApi.cleared' : 'agents.codexApi.saved'), error: false });
      onSaved?.();
    } catch (error) {
      setStatus({ busy: false, message: error instanceof Error ? error.message : t('agents.codexApi.failed'), error: true });
    }
  };

  return (
    <form className="space-y-4 rounded-lg border border-border p-4" onSubmit={event => { event.preventDefault(); void persist(); }}>
      <h4 className="font-medium">{t('agents.codexApi.title')}</h4>
      <p className="text-sm text-muted-foreground">{t('agents.codexApi.description')}</p>
      <label className="block space-y-1 text-sm">
        <span>{t('agents.codexApi.provider')}</span>
        <Input required maxLength={64} pattern={'[a-zA-Z][a-zA-Z0-9_\\-]*'} value={connection.provider}
          disabled={status.busy} onChange={event => setConnection(current => ({ ...current, provider: event.target.value }))} />
      </label>
      <p className="text-sm text-muted-foreground">{t('agents.codexApi.providerHelp')}</p>
      <label className="block space-y-1 text-sm">
        <span>{t('agents.codexApi.baseUrl')}</span>
        <Input type="url" required placeholder="https://api.openai.com/v1" value={connection.baseUrl}
          disabled={status.busy} onChange={event => setConnection(current => ({ ...current, baseUrl: event.target.value }))} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t('agents.codexApi.apiKey')}</span>
        <Input type="password" autoComplete="new-password" value={connection.apiKey} required={!connection.hasApiKey}
          disabled={status.busy} placeholder={t(connection.hasApiKey ? 'agents.codexApi.keepKey' : 'agents.codexApi.enterKey')}
          onChange={event => setConnection(current => ({ ...current, apiKey: event.target.value }))} />
      </label>
      <p className="text-sm text-muted-foreground">{t('agents.codexApi.protocol')}</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={status.busy}>{t('agents.codexApi.save')}</Button>
        {connection.hasApiKey && <Button type="button" variant="outline" disabled={status.busy} onClick={() => { void persist(true); }}>{t('agents.codexApi.clear')}</Button>}
      </div>
      {status.message && <p role={status.error ? 'alert' : 'status'} className={status.error ? 'text-sm text-red-600' : 'text-sm text-muted-foreground'}>{status.message}</p>}
    </form>
  );
}
