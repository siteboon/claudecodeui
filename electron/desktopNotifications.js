import fs from 'node:fs/promises';
import path from 'node:path';
import { Notification } from 'electron';
import WebSocket from 'ws';

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const TARGET_REGISTER_TIMEOUT_MS = 8000;

function toNotificationsWsUrl(httpUrl) {
  try {
    const parsed = new URL(httpUrl);
    parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:';
    parsed.pathname = '/desktop-notifications';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function readJsonMessage(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

async function requestJson(url, { method = 'POST', body = null, headers = {} } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TARGET_REGISTER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed with status ${response.status}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export class DesktopNotificationsController {
  constructor({
    settingsPath,
    appVersion,
    appName,
    getDeviceId,
    getAccountEmail,
    getRunningEnvironmentUrls,
    getApiKey,
    getAuthToken,
    getIconPath,
    openNotificationTarget,
    onChange,
  }) {
    this.settingsPath = settingsPath;
    this.appVersion = appVersion;
    this.appName = appName;
    this.getDeviceId = getDeviceId;
    this.getAccountEmail = getAccountEmail;
    this.getRunningEnvironmentUrls = getRunningEnvironmentUrls;
    this.getApiKey = getApiKey;
    this.getAuthToken = getAuthToken;
    this.getIconPath = getIconPath;
    this.openNotificationTarget = openNotificationTarget;
    this.onChange = onChange;
    this.settings = { enabled: false };
    this.connections = new Map();
    this.lastEvent = null;
    this.lastError = null;
  }

  getState() {
    const connectedTargets = [];
    for (const [url, connection] of this.connections.entries()) {
      if (connection.ws?.readyState === WebSocket.OPEN) {
        connectedTargets.push(url);
      }
    }

    return {
      enabled: this.settings.enabled,
      supported: Notification.isSupported(),
      targetCount: this.connections.size,
      connectedCount: connectedTargets.length,
      connectedTargets,
      lastEvent: this.lastEvent,
      lastError: this.lastError,
    };
  }

  async loadSettings() {
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf8');
      const stored = JSON.parse(raw);
      this.settings = { enabled: Boolean(stored.enabled) };
    } catch {
      this.settings = { enabled: false };
    }
    return this.settings;
  }

  async saveSettings(next) {
    const enabled = Boolean(next?.enabled);
    if (!enabled && this.settings.enabled) {
      await this.disableCurrentTargets();
    }
    this.settings = { enabled };
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
    await this.sync();
    this.onChange?.();
    return this.settings;
  }

  async sync() {
    if (!this.settings.enabled) {
      this.stop();
      this.lastEvent = 'disabled';
      this.onChange?.();
      return;
    }

    if (!Notification.isSupported()) {
      this.stop();
      this.lastEvent = 'unsupported';
      this.lastError = 'Native notifications are not supported on this system.';
      this.onChange?.();
      return;
    }

    const deviceId = this.getDeviceId?.();
    if (!deviceId) {
      this.stop();
      this.lastEvent = 'missing-device';
      this.lastError = 'Connect a CloudCLI account before enabling desktop notifications.';
      this.onChange?.();
      return;
    }

    const targets = (this.getRunningEnvironmentUrls?.() || [])
      .map((httpUrl) => ({
        httpUrl,
        wsUrl: toNotificationsWsUrl(httpUrl),
      }))
      .filter((target) => target.wsUrl);

    const nextWsUrls = new Set(targets.map((target) => target.wsUrl));
    for (const [wsUrl, connection] of this.connections.entries()) {
      if (!nextWsUrls.has(wsUrl)) {
        this.closeConnection(connection);
        this.connections.delete(wsUrl);
      }
    }

    for (const target of targets) {
      if (!this.connections.has(target.wsUrl)) {
        void this.connect(target).catch((error) => {
          this.lastEvent = 'connect-error';
          this.lastError = error instanceof Error ? error.message : String(error);
          this.onChange?.();
        });
      }
    }

    this.lastEvent = targets.length ? 'sync' : 'no-targets';
    this.onChange?.();
  }

  async connect(target, attempt = 0) {
    const existing = this.connections.get(target.wsUrl);
    if (existing?.ws && [WebSocket.CONNECTING, WebSocket.OPEN].includes(existing.ws.readyState)) {
      return;
    }

    const connection = {
      ...target,
      ws: null,
      reconnectTimer: null,
      closed: false,
      attempt,
    };
    this.connections.set(target.wsUrl, connection);

    const headers = await this.getTargetAuthHeaders(target.httpUrl);
    if (connection.closed || this.connections.get(target.wsUrl) !== connection) {
      return;
    }

    const ws = new WebSocket(target.wsUrl, { headers: Object.keys(headers).length ? headers : undefined });
    connection.ws = ws;

    ws.on('open', async () => {
      try {
        await this.registerTarget(target.httpUrl);
        ws.send(JSON.stringify({
          type: 'register',
          deviceId: this.getDeviceId?.(),
          label: this.getAccountEmail?.() || this.appName,
          platform: process.platform,
          appVersion: this.appVersion,
        }));
        connection.attempt = 0;
        this.lastEvent = 'connected';
        this.lastError = null;
        this.onChange?.();
      } catch (error) {
        this.lastEvent = 'register-error';
        this.lastError = error instanceof Error ? error.message : String(error);
        this.onChange?.();
        try { ws.close(); } catch {}
      }
    });

    ws.on('message', (raw) => this.handleMessage(target, ws, raw));
    ws.on('close', () => this.scheduleReconnect(target.wsUrl));
    ws.on('error', (error) => {
      this.lastEvent = 'socket-error';
      this.lastError = error instanceof Error ? error.message : String(error);
      this.onChange?.();
    });
  }

  async registerTarget(httpUrl) {
    const url = new URL('/api/notifications/endpoints/current', httpUrl).toString();
    await requestJson(url, {
      method: 'POST',
      headers: await this.getTargetAuthHeaders(httpUrl),
      body: {
        channel: 'desktop',
        endpointId: this.getDeviceId?.(),
        label: this.getAccountEmail?.() || this.appName,
        metadata: {
          platform: process.platform,
          appVersion: this.appVersion,
        },
        enabled: true,
      },
    });
  }

  async disableCurrentTargets() {
    const deviceId = this.getDeviceId?.();
    if (!deviceId) return;

    const targets = new Set([
      ...[...this.connections.values()].map((connection) => connection.httpUrl).filter(Boolean),
      ...(this.getRunningEnvironmentUrls?.() || []),
    ]);

    const results = await Promise.allSettled([...targets].map(async (httpUrl) => {
      const url = new URL(`/api/notifications/endpoints/desktop/${encodeURIComponent(deviceId)}`, httpUrl).toString();
      await requestJson(url, {
        method: 'PATCH',
        headers: await this.getTargetAuthHeaders(httpUrl),
        body: { enabled: false },
      });
    }));

    const rejected = results.find((result) => result.status === 'rejected');
    if (rejected) {
      this.lastEvent = 'disable-endpoint-error';
      this.lastError = rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason);
    }
  }

  async getTargetAuthHeaders(httpUrl) {
    const headers = {};
    const apiKey = this.getApiKey?.();
    if (apiKey) {
      headers['X-API-Key'] = apiKey;
    }

    const authToken = await Promise.resolve(this.getAuthToken?.(httpUrl)).catch(() => null);
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    return headers;
  }

  handleMessage(target, ws, raw) {
    const message = readJsonMessage(raw);
    if (!message || message.type !== 'notification' || !message.payload) {
      return;
    }

    const shown = this.showNativeNotification(target, message.payload);
    if (shown && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'notification_ack',
        id: message.id || message.payload?.data?.tag || null,
        action: 'shown',
      }));
    }
  }

  showNativeNotification(target, payload) {
    if (!Notification.isSupported()) return false;

    const notification = new Notification({
      title: payload.title || this.appName,
      body: payload.body || '',
      icon: this.getIconPath?.(),
      silent: false,
    });

    notification.on('click', () => {
      void this.openNotificationTarget?.({
        environmentUrl: target.httpUrl,
        sessionId: payload.data?.sessionId || null,
        provider: payload.data?.provider || null,
      }).catch((error) => {
        this.lastEvent = 'click-error';
        this.lastError = error instanceof Error ? error.message : String(error);
        this.onChange?.();
      });
    });

    notification.show();
    this.lastEvent = 'notification-shown';
    this.lastError = null;
    this.onChange?.();
    return true;
  }

  scheduleReconnect(wsUrl) {
    const connection = this.connections.get(wsUrl);
    if (!connection || connection.closed || !this.settings.enabled) {
      return;
    }

    const attempt = connection.attempt + 1;
    connection.attempt = attempt;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * (2 ** Math.min(attempt, 5)));
    connection.reconnectTimer = setTimeout(() => {
      if (!this.connections.has(wsUrl) || !this.settings.enabled) return;
      void this.connect({
        httpUrl: connection.httpUrl,
        wsUrl: connection.wsUrl,
      }, attempt).catch((error) => {
        this.lastEvent = 'connect-error';
        this.lastError = error instanceof Error ? error.message : String(error);
        this.onChange?.();
      });
    }, delay);
    this.lastEvent = 'reconnecting';
    this.onChange?.();
  }

  closeConnection(connection) {
    connection.closed = true;
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = null;
    }
    try { connection.ws?.close(); } catch {}
  }

  stop() {
    for (const connection of this.connections.values()) {
      this.closeConnection(connection);
    }
    this.connections.clear();
    this.onChange?.();
  }
}
