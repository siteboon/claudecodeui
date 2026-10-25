import { useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import type { WorkbenchAgentToken } from '@/shared/types';
import { getErrorText } from '@/shared/utils';
import { Button, Input } from '@/shared/ui';
import { sortTokens } from '@/modules/workbench-sessions/utils/agentAccessLogic';

type AgentTokensPanelProps = {
  tokens: WorkbenchAgentToken[];
  onChanged: () => Promise<void>;
};

/** Rendered by AgentAccessDialog: lists agent tokens, creates new ones (plaintext shown once) and revokes them after confirmation. */
export default function AgentTokensPanel({ tokens, onChanged }: AgentTokensPanelProps) {
  const { t, i18n } = useTranslation('workbench');
  // Name typed for the next token.
  const [name, setName] = useState('');
  // The just-created plaintext token. Held only in memory, only until dismissed: the server never returns it again.
  const [newToken, setNewToken] = useState<{ name: string; value: string } | null>(null);
  // Result of the copy button, so the user knows the clipboard write worked.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Token id awaiting the inline "really revoke?" confirmation.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // True while a create or revoke request runs.
  const [isBusy, setIsBusy] = useState(false);
  // Failure text of the last create or revoke.
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || isBusy) return;
    setIsBusy(true);
    setError(null);
    try {
      const body = await readApiJson<{ data: { token: string } }>(await api.workbench.createAgentToken(trimmed));
      setNewToken({ name: trimmed, value: body.data.token });
      setCopyState('idle');
      setName('');
      await onChanged();
    } catch (createError) {
      setError(getErrorText(createError));
    } finally {
      setIsBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken.value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const handleRevoke = async (id: string) => {
    setIsBusy(true);
    setError(null);
    try {
      await readApiJson(await api.workbench.revokeAgentToken(id));
      setConfirmingId(null);
      await onChanged();
    } catch (revokeError) {
      setError(getErrorText(revokeError));
    } finally {
      setIsBusy(false);
    }
  };

  const formatDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(i18n.language || 'en', { dateStyle: 'medium', timeStyle: 'short' }) : null;

  return (
    <section aria-labelledby="agent-tokens-heading" className="space-y-3">
      <div>
        <h3 id="agent-tokens-heading" className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <KeyRound className="h-3.5 w-3.5" /> {t('agentAccess.tokens.title')}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('agentAccess.tokens.explain')}</p>
      </div>

      {newToken && (
        <div role="status" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            {t('agentAccess.tokens.shownOnce', { name: newToken.name })}
          </p>
          <div className="flex items-stretch gap-2">
            <input
              readOnly
              value={newToken.value}
              aria-label={t('agentAccess.tokens.tokenValue')}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-2 font-mono text-xs text-foreground"
            />
            <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => void handleCopy()}>
              <Copy /> {copyState === 'copied' ? t('agentAccess.tokens.copied') : t('agentAccess.tokens.copy')}
            </Button>
          </div>
          {copyState === 'failed' && (
            <p role="alert" className="text-xs text-destructive">{t('agentAccess.tokens.copyFailed')}</p>
          )}
          <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => setNewToken(null)}>
            {t('agentAccess.tokens.savedIt')}
          </Button>
        </div>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void handleCreate();
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder={t('agentAccess.tokens.namePlaceholder')}
          aria-label={t('agentAccess.tokens.namePlaceholder')}
          className="h-11 min-w-0 flex-1 sm:h-9"
          autoComplete="off"
        />
        <Button type="submit" size="sm" className="min-h-11 sm:min-h-0" disabled={isBusy || !name.trim()}>
          {t('agentAccess.tokens.create')}
        </Button>
      </form>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {tokens.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('agentAccess.tokens.none')}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
          {sortTokens(tokens).map((token) => (
            <li key={token.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className={`truncate text-sm ${token.revoked ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {token.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t('agentAccess.tokens.created', { date: formatDate(token.createdAt) })}
                  {' · '}
                  {token.lastUsedAt
                    ? t('agentAccess.tokens.lastUsed', { date: formatDate(token.lastUsedAt) })
                    : t('agentAccess.tokens.neverUsed')}
                </p>
              </div>
              {token.revoked ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {t('agentAccess.tokens.revoked')}
                </span>
              ) : confirmingId === token.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t('agentAccess.tokens.revokeConfirm')}</span>
                  <Button type="button" size="sm" variant="destructive" className="min-h-11 sm:min-h-0" disabled={isBusy} onClick={() => void handleRevoke(token.id)}>
                    {t('agentAccess.tokens.revoke')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-0" disabled={isBusy} onClick={() => setConfirmingId(null)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-0" onClick={() => setConfirmingId(token.id)}>
                  {t('agentAccess.tokens.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
