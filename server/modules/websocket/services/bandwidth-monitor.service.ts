import { WebSocket } from 'ws';

/**
 * Optional, opt-in bandwidth monitoring. Tracks bytes sent by every response
 * the server emits (HTTP responses and every WebSocket channel: shell, chat,
 * desktop notifications, plugin proxy), bucketed by a coarse key, and logs
 * totals on an interval so they can be correlated against client-side data
 * usage readings. Disabled by default - enable with BANDWIDTH_MONITOR_ENABLED=true.
 */

export function isBandwidthMonitorEnabled(): boolean {
  return process.env.BANDWIDTH_MONITOR_ENABLED === 'true';
}

type BandwidthBucket = {
  messages: number;
  bytes: number;
};

const buckets = new Map<string, BandwidthBucket>();
const monitorStartedAt = Date.now();

function bucketFor(key: string): BandwidthBucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { messages: 0, bytes: 0 };
    buckets.set(key, bucket);
  }
  return bucket;
}

export function recordBandwidth(key: string, byteLength: number): void {
  if (!isBandwidthMonitorEnabled()) {
    return;
  }
  const bucket = bucketFor(key);
  bucket.messages += 1;
  bucket.bytes += byteLength;
}

export function estimateByteLength(data: unknown): number {
  if (typeof data === 'string') {
    return Buffer.byteLength(data, 'utf8');
  }
  if (Buffer.isBuffer(data)) {
    return data.length;
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  if (ArrayBuffer.isView(data)) {
    return data.byteLength;
  }
  return 0;
}

let loggingStarted = false;

export function startBandwidthLogging(intervalMs = 10_000): void {
  if (!isBandwidthMonitorEnabled() || loggingStarted) {
    return;
  }
  loggingStarted = true;

  const timer = setInterval(() => {
    const elapsedSec = ((Date.now() - monitorStartedAt) / 1000).toFixed(1);
    const entries = Array.from(buckets.entries()).sort((a, b) => b[1].bytes - a[1].bytes);
    const totalBytes = entries.reduce((sum, [, bucket]) => sum + bucket.bytes, 0);
    const breakdown = entries
      .map(([key, bucket]) => `${key}: ${bucket.messages} msgs / ${(bucket.bytes / 1024).toFixed(1)}KB`)
      .join(' | ');

    console.log(
      `[bandwidth-monitor] elapsed=${elapsedSec}s TOTAL=${(totalBytes / 1024).toFixed(1)}KB${breakdown ? ' | ' + breakdown : ''}`
    );
  }, intervalMs);

  timer.unref();
}

type TaggedWebSocket = WebSocket & { _bandwidthRoute?: string };

let webSocketSendPatched = false;

/**
 * Monkey-patches WebSocket.prototype.send once so every outbound WS frame on
 * every channel (shell, chat, desktop-notifications, plugin proxy) is
 * counted, without needing to instrument each service individually. No-op
 * unless bandwidth monitoring is enabled.
 */
export function patchWebSocketBandwidthTracking(): void {
  if (!isBandwidthMonitorEnabled() || webSocketSendPatched) {
    return;
  }
  webSocketSendPatched = true;

  const originalSend = WebSocket.prototype.send;

  WebSocket.prototype.send = function patchedSend(
    this: TaggedWebSocket,
    data: Parameters<typeof originalSend>[0],
    ...rest: unknown[]
  ) {
    try {
      const route = this._bandwidthRoute ?? 'ws:unknown';
      recordBandwidth(route, estimateByteLength(data));
    } catch {
      // Monitoring must never break real traffic.
    }

    // @ts-expect-error - forwarding the library's overloaded variadic signature as-is
    return originalSend.call(this, data, ...rest);
  };
}

export function tagWebSocketRoute(ws: WebSocket, route: string): void {
  if (!isBandwidthMonitorEnabled()) {
    return;
  }
  (ws as TaggedWebSocket)._bandwidthRoute = `ws:${route}`;
}
