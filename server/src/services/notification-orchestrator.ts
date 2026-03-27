import webPush from 'web-push';

import { notificationPreferencesDb } from '@/shared/database/repositories/notification-preferences.js';
import { pushSubscriptionsDb } from '@/shared/database/repositories/push-subscriptions.js';
import { sessionNamesDb } from '@/shared/database/repositories/session-names.js';

type NotificationKind = 'action_required' | 'stop' | 'error' | 'info' | string;

type NotificationEvent = {
  provider: string;
  sessionId?: string | null;
  kind?: NotificationKind;
  code?: string;
  meta?: Record<string, unknown>;
  severity?: string;
  dedupeKey?: string | null;
  requiresUserAction?: boolean;
  createdAt?: string;
};

type NotificationPreferences = {
  channels?: {
    inApp?: boolean;
    webPush?: boolean;
  };
  events?: {
    actionRequired?: boolean;
    stop?: boolean;
    error?: boolean;
  };
};

const KIND_TO_PREF_KEY: Record<string, keyof NonNullable<NotificationPreferences['events']>> = {
  action_required: 'actionRequired',
  stop: 'stop',
  error: 'error',
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
  system: 'System',
};

const recentEventKeys = new Map<string, number>();
const DEDUPE_WINDOW_MS = 20_000;

const cleanupOldEventKeys = (): void => {
  const now = Date.now();
  for (const [key, timestamp] of recentEventKeys.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEventKeys.delete(key);
    }
  }
};

function shouldSendPush(
  preferences: NotificationPreferences | null | undefined,
  event: NotificationEvent
): boolean {
  const webPushEnabled = Boolean(preferences?.channels?.webPush);
  const prefEventKey = KIND_TO_PREF_KEY[event.kind ?? ''];
  const eventEnabled = prefEventKey
    ? Boolean(preferences?.events?.[prefEventKey])
    : true;

  return webPushEnabled && eventEnabled;
}

function isDuplicate(event: NotificationEvent): boolean {
  cleanupOldEventKeys();
  const key =
    event.dedupeKey ??
    `${event.provider}:${event.kind ?? 'info'}:${event.code ?? 'generic'}:${event.sessionId ?? 'none'}`;

  if (recentEventKeys.has(key)) {
    return true;
  }
  recentEventKeys.set(key, Date.now());
  return false;
}

function normalizeErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  if (error == null) {
    return 'Unknown error';
  }

  return String(error);
}

function normalizeSessionName(sessionName: unknown): string | null {
  if (typeof sessionName !== 'string') {
    return null;
  }

  const normalized = sessionName.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function resolveSessionName(event: NotificationEvent): string | null {
  const explicitSessionName = normalizeSessionName(event.meta?.sessionName);
  if (explicitSessionName) {
    return explicitSessionName;
  }

  if (!event.sessionId || !event.provider) {
    return null;
  }

  return normalizeSessionName(sessionNamesDb.getSessionName(event.sessionId, event.provider));
}

function buildPushBody(event: NotificationEvent) {
  const codeMap: Record<string, string> = {
    'permission.required': event.meta?.toolName
      ? `Action Required: Tool "${String(event.meta.toolName)}" needs approval`
      : 'Action Required: A tool needs your approval',
    'run.stopped':
      (typeof event.meta?.stopReason === 'string' && event.meta.stopReason) ||
      'Run Stopped: The run has stopped',
    'run.failed': event.meta?.error
      ? `Run Failed: ${String(event.meta.error)}`
      : 'Run Failed: The run encountered an error',
    'agent.notification': event.meta?.message
      ? String(event.meta.message)
      : 'You have a new notification',
    'push.enabled': 'Push notifications are now enabled!',
  };

  const providerLabel = PROVIDER_LABELS[event.provider] ?? 'Assistant';
  const sessionName = resolveSessionName(event);
  const message = codeMap[event.code ?? ''] ?? 'You have a new notification';

  return {
    title: sessionName ?? 'Claude Code UI',
    body: `${providerLabel}: ${message}`,
    data: {
      sessionId: event.sessionId ?? null,
      code: event.code ?? null,
      provider: event.provider ?? null,
      sessionName,
      tag: `${event.provider ?? 'assistant'}:${event.sessionId ?? 'none'}:${event.code ?? 'generic.info'}`,
    },
  };
}

async function sendWebPush(userId: number, event: NotificationEvent): Promise<void> {
  const subscriptions = pushSubscriptionsDb.getPushSubscriptions(userId);
  if (!subscriptions.length) return;

  const payload = JSON.stringify(buildPushBody(event));

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth,
          },
        },
        payload
      )
    )
  );

  // Clean up gone subscriptions (410 Gone or 404).
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const statusCode = (result.reason as { statusCode?: number } | undefined)
        ?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        pushSubscriptionsDb.deletePushSubscription(subscriptions[index].endpoint);
      }
    }
  });
}

function createNotificationEvent({
  provider,
  sessionId = null,
  kind = 'info',
  code = 'generic.info',
  meta = {},
  severity = 'info',
  dedupeKey = null,
  requiresUserAction = false,
}: {
  provider: string;
  sessionId?: string | null;
  kind?: NotificationKind;
  code?: string;
  meta?: Record<string, unknown>;
  severity?: string;
  dedupeKey?: string | null;
  requiresUserAction?: boolean;
}): NotificationEvent {
  return {
    provider,
    sessionId,
    kind,
    code,
    meta,
    severity,
    requiresUserAction,
    dedupeKey,
    createdAt: new Date().toISOString(),
  };
}

function notifyUserIfEnabled({
  userId,
  event,
}: {
  userId: number | null | undefined;
  event: NotificationEvent | null | undefined;
}): void {
  if (!userId || !event) {
    return;
  }

  const preferences = notificationPreferencesDb.getNotificationPreferences(userId);
  if (!shouldSendPush(preferences, event)) {
    return;
  }
  if (isDuplicate(event)) {
    return;
  }

  sendWebPush(userId, event).catch((error) => {
    console.error('Web push send error:', error);
  });
}

function notifyRunStopped({
  userId,
  provider,
  sessionId = null,
  stopReason = 'completed',
  sessionName = null,
}: {
  userId: number;
  provider: string;
  sessionId?: string | null;
  stopReason?: string;
  sessionName?: string | null;
}): void {
  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason, sessionName },
      severity: 'info',
      dedupeKey: `${provider}:run:stop:${sessionId ?? 'none'}:${stopReason}`,
    }),
  });
}

function notifyRunFailed({
  userId,
  provider,
  sessionId = null,
  error,
  sessionName = null,
}: {
  userId: number;
  provider: string;
  sessionId?: string | null;
  error: unknown;
  sessionName?: string | null;
}): void {
  const errorMessage = normalizeErrorMessage(error);

  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'error',
      code: 'run.failed',
      meta: { error: errorMessage, sessionName },
      severity: 'error',
      dedupeKey: `${provider}:run:error:${sessionId ?? 'none'}:${errorMessage}`,
    }),
  });
}

export {
  createNotificationEvent,
  notifyUserIfEnabled,
  notifyRunStopped,
  notifyRunFailed,
};

