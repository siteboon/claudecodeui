import webPush from 'web-push';
import { notificationPreferencesDb, pushSubscriptionsDb } from '../database/db.js';

const KIND_TO_PREF_KEY = {
  action_required: 'actionRequired',
  stop: 'stop',
  error: 'error'
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

function buildPushBody(event) {
  const CODE_MAP = {
    'permission.required': {
      title: 'Action Required',
      body: event.meta?.toolName
        ? `Tool "${event.meta.toolName}" needs approval`
        : 'A tool needs your approval'
    },
    'run.stopped': {
      title: 'Run Stopped',
      body: event.meta?.stopReason || 'The run has stopped'
    },
    'run.failed': {
      title: 'Run Failed',
      body: event.meta?.error ? String(event.meta.error) : 'The run encountered an error'
    },
    'agent.notification': {
      title: 'Agent Notification',
      body: event.meta?.message ? String(event.meta.message) : 'You have a new notification'
    }
  };

  const mapped = CODE_MAP[event.code];
  return {
    title: mapped?.title || 'Claude Code UI',
    body: mapped?.body || 'You have a new notification',
    data: {
      sessionId: event.sessionId || null,
      code: event.code
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

export {
  createNotificationEvent,
  notifyUserIfEnabled
};
