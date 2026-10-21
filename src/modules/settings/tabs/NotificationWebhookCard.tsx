import { useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Send, Trash2, Webhook } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useNotificationWebhook } from '@/modules/settings/hooks/useNotificationWebhook';
import { Button, Input } from '@/shared/ui';
import type { NotificationWebhookDelivery } from '@/shared/types';
import { copyTextToClipboard } from '@/shared/utils';

// Server error codes → `notifications.webhook.errors.*` keys.
const ERROR_MESSAGE_KEYS: Record<string, string> = {
  WEBHOOK_URL_INVALID: 'invalidUrl',
  WEBHOOK_URL_INSECURE: 'insecureUrl',
  WEBHOOK_URL_BLOCKED: 'blockedAddress',
  WEBHOOK_NOT_CONFIGURED: 'notConfigured',
  REQUEST_FAILED: 'requestFailed',
};

/** Rendered by NotificationsSettingsTab: the outbound webhook destination, its signing secret and a test event. */
export default function NotificationWebhookCard() {
  const { t, i18n } = useTranslation('settings');
  const {
    webhook,
    draft,
    isDirty,
    pendingAction,
    errorCode,
    saved,
    revealedSecret,
    updateDraft,
    save,
    remove,
    createSecret,
    removeSecret,
    sendTest,
    dismissSecret,
  } = useNotificationWebhook();
  // Brief "Copied" confirmation on the show-once secret's copy button.
  const [secretCopied, setSecretCopied] = useState(false);

  const busy = pendingAction !== null;
  const configured = Boolean(webhook?.configured);
  const canSave = draft.url.trim() !== '' && (isDirty || !configured);

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' });
  };

  const describeDelivery = (delivery: NotificationWebhookDelivery) => {
    const time = formatTime(delivery.at);
    if (delivery.ok) {
      return t('notifications.webhook.status.ok', { type: delivery.type, time, status: delivery.status });
    }
    const reason = t(`notifications.webhook.reasons.${delivery.error ?? 'network'}`, { status: delivery.status });
    return t('notifications.webhook.status.failed', { type: delivery.type, time, attempts: delivery.attempts, reason });
  };

  const copySecret = async () => {
    if (revealedSecret && await copyTextToClipboard(revealedSecret)) {
      setSecretCopied(true);
      window.setTimeout(() => setSecretCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4" data-testid="notification-webhook-card">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Webhook className="h-4 w-4 text-blue-600" />
          <h4 className="font-medium text-foreground">{t('notifications.webhook.title')}</h4>
        </div>
        <p className="text-sm text-muted-foreground">{t('notifications.webhook.description')}</p>
      </div>

      {webhook === null && !errorCode ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="notification-webhook-url" className="text-sm font-medium text-foreground">
                {t('notifications.webhook.urlLabel')}
              </label>
              <Input
                id="notification-webhook-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={t('notifications.webhook.urlPlaceholder')}
                value={draft.url}
                onChange={(event) => updateDraft({ url: event.target.value })}
              />
            </div>

            <label className="flex items-start gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.allowHttp}
                onChange={(event) => updateDraft({ allowHttp: event.target.checked })}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              {t('notifications.webhook.allowHttp')}
            </label>

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => updateDraft({ enabled: event.target.checked })}
                className="h-4 w-4"
              />
              {t('notifications.webhook.enabled')}
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={busy || !canSave} onClick={() => void save()}>
                {pendingAction === 'save' && <Loader2 className="h-4 w-4 animate-spin" />}
                {pendingAction === 'save' ? t('notifications.webhook.saving') : t('notifications.webhook.save')}
              </Button>
              {configured && (
                <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void remove()}>
                  <Trash2 className="h-4 w-4" />
                  {t('notifications.webhook.remove')}
                </Button>
              )}
              {saved && (
                <span className="text-sm text-green-600 dark:text-green-400">{t('notifications.webhook.saved')}</span>
              )}
            </div>

            {errorCode && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {t(`notifications.webhook.errors.${ERROR_MESSAGE_KEYS[errorCode] ?? 'requestFailed'}`)}
              </p>
            )}
          </div>

          {configured && webhook && (
            <>
              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">{t('notifications.webhook.secret.title')}</span>
                      <span className="text-sm text-muted-foreground">
                        · {webhook.hasSecret ? t('notifications.webhook.secret.set') : t('notifications.webhook.secret.none')}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{t('notifications.webhook.secret.description')}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void createSecret()}>
                      {webhook.hasSecret ? t('notifications.webhook.secret.rotate') : t('notifications.webhook.secret.generate')}
                    </Button>
                    {webhook.hasSecret && (
                      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void removeSecret()}>
                        {t('notifications.webhook.secret.remove')}
                      </Button>
                    )}
                  </div>
                </div>

                {revealedSecret && (
                  <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3" data-testid="notification-webhook-secret">
                    <p className="mb-2 text-sm text-muted-foreground">{t('notifications.webhook.secret.showOnce')}</p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 break-all rounded bg-background/50 px-3 py-2 font-mono text-sm">
                        {revealedSecret}
                      </code>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={secretCopied ? t('notifications.webhook.secret.copied') : t('notifications.webhook.secret.copy')}
                        onClick={() => void copySecret()}
                      >
                        {secretCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={dismissSecret}>
                      {t('notifications.webhook.secret.dismiss')}
                    </Button>
                  </div>
                )}
              </div>

              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || isDirty}
                    onClick={() => void sendTest()}
                  >
                    {pendingAction === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {pendingAction === 'test' ? t('notifications.webhook.test.sending') : t('notifications.webhook.test.send')}
                  </Button>
                  <span
                    data-testid="notification-webhook-status"
                    className={`min-w-0 text-sm ${
                      webhook.lastDelivery && !webhook.lastDelivery.ok
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {webhook.lastDelivery ? describeDelivery(webhook.lastDelivery) : t('notifications.webhook.status.never')}
                  </span>
                </div>
              </div>
            </>
          )}

          <div className="space-y-1 text-xs text-muted-foreground">
            <p>{t('notifications.webhook.payloadNote')}</p>
            <p>{t('notifications.webhook.eventsNote')}</p>
          </div>
        </>
      )}
    </div>
  );
}
