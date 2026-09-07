import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Loader2 } from 'lucide-react';

import { api } from '@/shared/api';
import { writeDraftText } from '@/shared/chatDrafts';
import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import type { LLMProvider, ProviderModelsDefinition } from '@/shared/types';

type SessionHandoffButtonProps = {
  sessionId: string;
  provider: LLMProvider;
  disabled: boolean;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  onNavigate: (sessionId: string) => void;
};

/** Used by ChatInterface to prepare a linked conversation with another provider. */
export function SessionHandoffButton({ sessionId, provider, disabled, providerModelCatalog, onNavigate }: SessionHandoffButtonProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<{ provider: LLMProvider; model: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const createHandoff = async () => {
    if (!selection || pending || disabled) return;
    setPending(true);
    setError(null);
    try {
      const response = await api.handoffSession(sessionId, selection);
      const payload = await response.json();
      if (!response.ok || typeof payload?.data?.sessionId !== 'string' || typeof payload?.data?.draft !== 'string') {
        throw new Error(payload?.error?.message || t('handoff.error'));
      }
      if (!mounted.current) return;
      writeDraftText(payload.data.sessionId, payload.data.draft);
      setOpen(false);
      onNavigate(payload.data.sessionId);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : t('handoff.error'));
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={() => { setError(null); setOpen(true); }}>
        <ArrowRightLeft className="mr-2 h-4 w-4" />
        {t('handoff.title')}
      </Button>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t('handoff.title')}</DialogTitle>
        <p className="text-sm text-muted-foreground">{t('handoff.description')}</p>
        <label className="flex flex-col gap-2 text-sm">
          {t('handoff.model')}
          <select
            className="rounded-md border bg-background p-2 text-foreground"
            disabled={pending}
            value={selection ? JSON.stringify(selection) : ''}
            onChange={(event) => setSelection(JSON.parse(event.target.value))}
          >
            <option value="" disabled>{t('handoff.chooseModel')}</option>
            {Object.entries(providerModelCatalog).filter(([target]) => target !== provider).map(([target, catalog]) => (
              <optgroup key={target} label={t(`messageTypes.${target}`)}>
                {catalog?.OPTIONS.map((model) => (
                  <option key={model.value} value={JSON.stringify({ provider: target, model: model.value })}>{model.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">{t('handoff.limitations')}</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => setOpen(false)}>{t('handoff.cancel')}</Button>
          <Button disabled={!selection || pending || disabled} onClick={() => void createHandoff()}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('handoff.createDraft')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
