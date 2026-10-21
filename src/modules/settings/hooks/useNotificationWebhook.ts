import { useCallback, useEffect, useState } from 'react';

import { api, ApiRequestError, readApiJson } from '@/shared/api';
import type { NotificationWebhookDelivery, NotificationWebhookState } from '@/shared/types';

type WebhookDraft = {
  url: string;
  allowHttp: boolean;
  enabled: boolean;
};

type WebhookAction = 'save' | 'remove' | 'secret' | 'test';

type WebhookResponse = { data: { webhook: NotificationWebhookState } };
type WebhookSecretResponse = { data: { secret: string; webhook: NotificationWebhookState } };
type WebhookTestResponse = { data: { delivery: NotificationWebhookDelivery; webhook: NotificationWebhookState } };

const EMPTY_DRAFT: WebhookDraft = { url: '', allowHttp: false, enabled: true };

// A new destination starts enabled: saving a URL means "send to it".
const draftFrom = (webhook: NotificationWebhookState): WebhookDraft => (
  webhook.configured
    ? { url: webhook.url, allowHttp: webhook.allowHttp, enabled: webhook.enabled }
    : EMPTY_DRAFT
);

// Server error codes the card has a message for → `notifications.webhook.errors.*`
// keys. Any other failure shows the generic `requestFailed` message.
const ERROR_MESSAGE_KEYS = new Map([
  ['WEBHOOK_URL_INVALID', 'invalidUrl'],
  ['WEBHOOK_URL_INSECURE', 'insecureUrl'],
  ['WEBHOOK_URL_BLOCKED', 'blockedAddress'],
  ['WEBHOOK_NOT_CONFIGURED', 'notConfigured'],
]);

const readErrorMessageKey = (error: unknown): string => (
  (error instanceof ApiRequestError && error.code && ERROR_MESSAGE_KEYS.get(error.code)) || 'requestFailed'
);

/** Used by NotificationWebhookCard to load and edit the webhook destination, its signing secret and its test event. */
export function useNotificationWebhook() {
  // Server copy of the destination; null until the first load finishes.
  const [webhook, setWebhook] = useState<NotificationWebhookState | null>(null);
  // Unsaved form values, so typing never sends a request and Save is explicit.
  const [draft, setDraft] = useState<WebhookDraft>(EMPTY_DRAFT);
  // Which request is running, to disable the buttons and label the busy one.
  const [pendingAction, setPendingAction] = useState<WebhookAction | null>(null);
  // Message key (`notifications.webhook.errors.*`) of the last failed request, shown under
  // the form until the next edit or action. A failed first load shows it instead of the form.
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);
  // Set after a successful save and cleared by the next edit, to confirm the save.
  const [saved, setSaved] = useState(false);
  // The freshly generated signing secret. The server returns it only once, so it lives
  // here until dismissed and is gone after a reload.
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const applyWebhook = useCallback((next: NotificationWebhookState) => {
    setWebhook(next);
    setDraft(draftFrom(next));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await readApiJson<WebhookResponse>(await api.settings.notificationWebhook.get());
        if (!cancelled) {
          applyWebhook(response.data.webhook);
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessageKey(readErrorMessageKey(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyWebhook]);

  const run = useCallback(async (action: WebhookAction, request: () => Promise<void>) => {
    setPendingAction(action);
    setErrorMessageKey(null);
    setSaved(false);
    try {
      await request();
    } catch (error) {
      setErrorMessageKey(readErrorMessageKey(error));
    } finally {
      setPendingAction(null);
    }
  }, []);

  const updateDraft = useCallback((patch: Partial<WebhookDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
    setErrorMessageKey(null);
  }, []);

  const save = useCallback(() => run('save', async () => {
    const response = await readApiJson<WebhookResponse>(
      await api.settings.notificationWebhook.save({ ...draft, url: draft.url.trim() }),
    );
    applyWebhook(response.data.webhook);
    setSaved(true);
  }), [applyWebhook, draft, run]);

  const remove = useCallback(() => run('remove', async () => {
    await readApiJson(await api.settings.notificationWebhook.remove());
    setRevealedSecret(null);
    applyWebhook({ configured: false, enabled: false, url: '', allowHttp: false, hasSecret: false, lastDelivery: null });
  }), [applyWebhook, run]);

  const createSecret = useCallback(() => run('secret', async () => {
    const response = await readApiJson<WebhookSecretResponse>(await api.settings.notificationWebhook.createSecret());
    setRevealedSecret(response.data.secret);
    setWebhook(response.data.webhook);
  }), [run]);

  const removeSecret = useCallback(() => run('secret', async () => {
    const response = await readApiJson<WebhookResponse>(await api.settings.notificationWebhook.removeSecret());
    setRevealedSecret(null);
    setWebhook(response.data.webhook);
  }), [run]);

  const sendTest = useCallback(() => run('test', async () => {
    const response = await readApiJson<WebhookTestResponse>(await api.settings.notificationWebhook.sendTest());
    setWebhook(response.data.webhook);
  }), [run]);

  const isDirty = webhook !== null && (
    draft.url.trim() !== (webhook.configured ? webhook.url : '')
    || draft.allowHttp !== (webhook.configured ? webhook.allowHttp : false)
    || (webhook.configured && draft.enabled !== webhook.enabled)
  );

  return {
    webhook,
    draft,
    isDirty,
    pendingAction,
    errorMessageKey,
    saved,
    revealedSecret,
    updateDraft,
    save,
    remove,
    createSecret,
    removeSecret,
    sendTest,
    dismissSecret: () => setRevealedSecret(null),
  };
}
