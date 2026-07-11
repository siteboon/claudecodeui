import type { WebSocket } from 'ws';

import {
  registerDesktopNotificationClient,
  unregisterDesktopNotificationClient,
} from '@/modules/notifications/services/desktop-notification-clients.service.js';
import type { AuthenticatedWebSocketRequest } from '@/shared/types.js';
import { parseIncomingJsonObject } from '@/shared/utils.js';

type DesktopNotificationRegisterMessage = {
  type?: unknown;
  kind?: unknown;
  deviceId?: unknown;
  label?: unknown;
  platform?: unknown;
  appVersion?: unknown;
};

function readRequestUserId(request: AuthenticatedWebSocketRequest): number | null {
  const user = request.user;
  const rawUserId = typeof user?.id === 'number' || typeof user?.id === 'string'
    ? user.id
    : typeof user?.userId === 'number' || typeof user?.userId === 'string'
      ? user.userId
      : null;
  const numericUserId = Number(rawUserId);
  return Number.isInteger(numericUserId) && numericUserId > 0 ? numericUserId : null;
}

function readOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function handleDesktopNotificationsConnection(
  ws: WebSocket,
  request: AuthenticatedWebSocketRequest
): void {
  const userId = readRequestUserId(request);
  if (!userId) {
    ws.close(1008, 'Missing authenticated user');
    return;
  }

  let registered = false;

  ws.on('message', (rawMessage) => {
    const data = parseIncomingJsonObject(rawMessage) as DesktopNotificationRegisterMessage | null;
    if (!data) {
      return;
    }

    const type = typeof data.type === 'string' ? data.type : typeof data.kind === 'string' ? data.kind : '';
    if (type === 'notification_ack') {
      return;
    }

    if (type !== 'register' || registered) {
      return;
    }

    const deviceId = readOptionalString(data.deviceId);
    if (!deviceId) {
      sendJson(ws, {
        type: 'error',
        code: 'DEVICE_ID_REQUIRED',
        message: 'Desktop notification registration requires deviceId.',
      });
      ws.close(1008, 'Missing deviceId');
      return;
    }

    const device = registerDesktopNotificationClient({
      userId,
      deviceId,
      label: readOptionalString(data.label),
      platform: readOptionalString(data.platform),
      appVersion: readOptionalString(data.appVersion),
      ws,
    });

    if (!device) {
      ws.close(1011, 'Registration failed');
      return;
    }

    registered = true;
    sendJson(ws, {
      type: 'registered',
      deviceId: device.endpoint_id,
      enabled: Boolean(device.enabled),
    });
  });

  ws.on('close', () => {
    unregisterDesktopNotificationClient(ws);
  });

  ws.on('error', () => {
    unregisterDesktopNotificationClient(ws);
  });
}
