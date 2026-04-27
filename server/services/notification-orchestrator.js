import webPush from 'web-push';

import { notificationPreferencesDb, pushSubscriptionsDb, sessionsDb } from '../modules/database/index.js';

const KIND_TO_PREF_KEY = {
  action_required: 'actionRequired',
  stop: 'stop',
  error: 'error'
};

const PROVIDER_LABELS = {
  claude: 'Claude',
  cursor: 'Cursor',
  codex: 'Codex',
  gemini: 'Gemini',
  system: 'System'
};

const recentEventKeys = new Map();
const DEDUPE_WINDOW_MS = 20000;

const cleanupOldEventKeys = () => {
  const now = Date.now();
  for (const [key, timestamp] of recentEventKeys.entries()) {
    if (now - timestamp > DEDUPE_WINDOW_MS) {
      recentEventKeys.delete(key);
    }
  }
};

function shouldSendPush(preferences, event) {
  const webPushEnabled = Boolean(preferences?.channels?.webPush);
  const prefEventKey = KIND_TO_PREF_KEY[event.kind];
  const eventEnabled = prefEventKey ? Boolean(preferences?.events?.[prefEventKey]) : true;

  return webPushEnabled && eventEnabled;
}

function isDuplicate(event) {
  cleanupOldEventKeys();
  const key = event.dedupeKey || `${event.provider}:${event.kind || 'info'}:${event.code || 'generic'}:${event.sessionId || 'none'}`;
  if (recentEventKeys.has(key)) {
    return true;
  }
  recentEventKeys.set(key, Date.now());
  return false;
}

function createNotificationEvent({
  provider,
  sessionId = null,
  kind = 'info',
  code = 'generic.info',
  meta = {},
  severity = 'info',
  dedupeKey = null,
  requiresUserAction = false
}) {
  return {
    provider,
    sessionId,
    kind,
    code,
    meta,
    severity,
    requiresUserAction,
    dedupeKey,
    createdAt: new Date().toISOString()
  };
}

function normalizeErrorMessage(error) {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error.message === 'string') {
    return error.message;
  }

  if (error == null) {
    return 'Unknown error';
  }

  return String(error);
}

function normalizeSessionName(sessionName) {
  if (typeof sessionName !== 'string') {
    return null;
  }

  const normalized = sessionName.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }

  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function resolveSessionName(event) {
  const explicitSessionName = normalizeSessionName(event.meta?.sessionName);
  if (explicitSessionName) {
    return explicitSessionName;
  }

  if (!event.sessionId || !event.provider) {
    return null;
  }

  return normalizeSessionName(sessionsDb.getSessionName(event.sessionId, event.provider));
}

function buildPushBody(event) {
  const CODE_MAP = {
    'permission.required': event.meta?.toolName
      ? `Action Required: Tool "${event.meta.toolName}" needs approval`
      : 'Action Required: A tool needs your approval',
    'run.stopped': event.meta?.stopReason || 'Run Stopped: The run has stopped',
    'run.failed': event.meta?.error ? `Run Failed: ${event.meta.error}` : 'Run Failed: The run encountered an error',
    'agent.notification': event.meta?.message ? String(event.meta.message) : 'You have a new notification',
    'push.enabled': 'Push notifications are now enabled!'
  };
  const providerLabel = PROVIDER_LABELS[event.provider] || 'Assistant';
  const sessionName = resolveSessionName(event);
  const message = CODE_MAP[event.code] || 'You have a new notification';

  return {
    title: sessionName || 'CloudCLI',
    body: `${providerLabel}: ${message}`,
    data: {
      sessionId: event.sessionId || null,
      code: event.code,
      provider: event.provider || null,
      sessionName,
      tag: `${event.provider || 'assistant'}:${event.sessionId || 'none'}:${event.code}`
    }
  };
}

async function sendWebPush(userId, event) {
  const subscriptions = pushSubscriptionsDb.getSubscriptions(userId);
  if (!subscriptions.length) return;

  const payload = JSON.stringify(buildPushBody(event));

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth
          }
        },
        payload
      )
    )
  );

  // Clean up gone subscriptions (410 Gone or 404)
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      const statusCode = result.reason?.statusCode;
      if (statusCode === 410 || statusCode === 404) {
        pushSubscriptionsDb.removeSubscription(subscriptions[index].endpoint);
      }
    }
  });
}

function notifyUserIfEnabled({ userId, event }) {
  if (!userId || !event) {
    return;
  }

  const preferences = notificationPreferencesDb.getPreferences(userId);
  if (!shouldSendPush(preferences, event)) {
    return;
  }
  if (isDuplicate(event)) {
    return;
  }

  sendWebPush(userId, event).catch((err) => {
    console.error('Web push send error:', err);
  });
}

function notifyRunStopped({ userId, provider, sessionId = null, stopReason = 'completed', sessionName = null }) {
  notifyUserIfEnabled({
    userId,
    event: createNotificationEvent({
      provider,
      sessionId,
      kind: 'stop',
      code: 'run.stopped',
      meta: { stopReason, sessionName },
      severity: 'info',
      dedupeKey: `${provider}:run:stop:${sessionId || 'none'}:${stopReason}`
    })
  });
}

function notifyRunFailed({ userId, provider, sessionId = null, error, sessionName = null }) {
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
      dedupeKey: `${provider}:run:error:${sessionId || 'none'}:${errorMessage}`
    })
  });
}

export {
  createNotificationEvent,
  notifyUserIfEnabled,
  notifyRunStopped,
  notifyRunFailed
};
