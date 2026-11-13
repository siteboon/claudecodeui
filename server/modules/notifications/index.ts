import {
  notifyRunFailed as notifyRunFailedLegacy,
  notifyRunStopped as notifyRunStoppedLegacy,
} from './services/notification-orchestrator.service.js';

type RunNotificationContext = {
  userId: string | number | null;
  provider: string;
  sessionId?: string | null;
  sessionName?: string | null;
};

/** Used by provider runtimes to report failures with nullable app-session metadata. */
export const notifyRunFailed = notifyRunFailedLegacy as (
  input: RunNotificationContext & { error: unknown },
) => void;

/** Used by provider runtimes to report completion with nullable app-session metadata. */
export const notifyRunStopped = notifyRunStoppedLegacy as (
  input: RunNotificationContext & { stopReason?: string },
) => void;

export {
  // Used by notification tests and delivery workflows to create channel payloads.
  buildNotificationPayload,
  // Used by provider runtimes and Settings to create normalized notification events.
  createNotificationEvent,
  // Used by provider runtimes and Settings to deliver events through enabled channels.
  notifyUserIfEnabled,
  // Used by provider runtimes to report background work that finished after its turn ended.
  notifyBackgroundWorkCompleted,
} from '@/modules/notifications/services/notification-orchestrator.service.js';
export {
  registerDesktopNotificationClient,
  sendDesktopNotification,
  unregisterDesktopNotificationClient,
} from '@/modules/notifications/services/desktop-notification-clients.service.js';
export { handleDesktopNotificationsConnection } from '@/modules/notifications/websocket/desktop-notifications-websocket.service.js';
// getPublicKey: used by Settings to expose the Web Push subscription key.
export { getPublicKey } from './vapid-keys.service.js';
// configureWebPush: used by the server entrypoint during notification startup.
export { configureWebPush } from './vapid-keys.service.js';
