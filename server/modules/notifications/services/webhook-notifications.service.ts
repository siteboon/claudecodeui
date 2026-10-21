import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

import { notificationChannelEndpointsDb } from '@/modules/database/index.js';
import { AppError } from '@/shared/utils.js';

/**
 * Outbound webhook channel for run lifecycle notifications.
 *
 * The owner stores one destination URL in Settings (a `webhook` row in
 * notification_channel_endpoints). The orchestrator hands every event to this
 * channel; only run completion, failure and cancellation are sent, as a small
 * versioned JSON body that carries no prompt, message, output or error text.
 * Delivery runs off the run's path, never rejects, and records its outcome on
 * the endpoint row so Settings can show it.
 *
 * Destination policy (same as the voice proxy's server-side URLs): https by
 * default, http only after an explicit opt-in, loopback/LAN/private addresses
 * allowed, link-local (cloud metadata), unspecified, multicast and reserved
 * addresses refused. Hostnames are checked on every resolved address at
 * connect time, and redirects are never followed.
 */

/** Used by notifications.routes to keep the generic endpoint routes away from this channel. */
export const WEBHOOK_CHANNEL = 'webhook';
// One destination per user in v1.
const WEBHOOK_ENDPOINT_ID = 'default';
const WEBHOOK_PAYLOAD_VERSION = 1;
const WEBHOOK_SECRET_PREFIX = 'whsec_';
const WEBHOOK_USER_AGENT = 'CloudCLI-Webhooks/1';
const MAX_WEBHOOK_URL_LENGTH = 2048;
// Response bodies are never read for content; this much is drained before the
// connection is dropped.
const MAX_RESPONSE_BYTES = 4096;

type WebhookEventType =
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'run.background_completed'
  | 'webhook.test';

type WebhookOutcome = 'completed' | 'failed' | 'cancelled' | null;

type WebhookUrlErrorCode = 'WEBHOOK_URL_INVALID' | 'WEBHOOK_URL_INSECURE' | 'WEBHOOK_URL_BLOCKED';

// Stored and returned as-is; the Settings client maps each to a localized message.
type WebhookDeliveryError =
  | 'invalidUrl'
  | 'insecureUrl'
  | 'blockedAddress'
  | 'timeout'
  | 'redirect'
  | 'httpStatus'
  | 'network'
  | 'tls'
  | 'dropped';

type WebhookEventBody = {
  version: number;
  id: string;
  type: WebhookEventType;
  createdAt: string;
  provider: string | null;
  sessionId: string | null;
  outcome: WebhookOutcome;
  test: boolean;
};

type WebhookDelivery = {
  eventId: string;
  type: WebhookEventType;
  ok: boolean;
  status: number | null;
  error: WebhookDeliveryError | null;
  attempts: number;
  at: string;
};

type WebhookConfigView = {
  configured: boolean;
  enabled: boolean;
  url: string;
  allowHttp: boolean;
  hasSecret: boolean;
  lastDelivery: WebhookDelivery | null;
};

type WebhookTarget = {
  url: string;
  allowHttp: boolean;
  secret: string | null;
};

type StoredWebhook = WebhookTarget & {
  enabled: boolean;
  label: string | null;
  lastDelivery: WebhookDelivery | null;
};

type AttemptResult = {
  status: number | null;
  error: WebhookDeliveryError | null;
  retryable: boolean;
};

// The orchestrator is JavaScript; only the fields read here are typed.
type LifecycleEvent = {
  provider?: unknown;
  sessionId?: unknown;
  code?: unknown;
  meta?: { stopReason?: unknown } | null;
  createdAt?: unknown;
};

type WebhookNotifierOptions = {
  attemptTimeoutMs: number;
  // Waits before the 2nd, 3rd, ... attempt; its length + 1 is the attempt cap.
  retryDelaysMs: readonly number[];
  maxInFlight: number;
  resolveHost: typeof dns.lookup;
};

const DEFAULT_NOTIFIER_OPTIONS: WebhookNotifierOptions = {
  attemptTimeoutMs: 5000,
  retryDelaysMs: [2000, 10_000],
  maxInFlight: 20,
  resolveHost: dns.lookup,
};

// Destinations a webhook must never reach. IPv4-mapped IPv6 forms
// (::ffff:169.254.169.254, ::ffff:a9fe:a9fe) match the IPv4 rules.
const blockedAddresses = new net.BlockList();
blockedAddresses.addSubnet('0.0.0.0', 8, 'ipv4'); // "this network", incl. 0.0.0.0
blockedAddresses.addSubnet('169.254.0.0', 16, 'ipv4'); // link-local, incl. AWS/GCP/Azure metadata
blockedAddresses.addSubnet('224.0.0.0', 4, 'ipv4'); // multicast
blockedAddresses.addSubnet('240.0.0.0', 4, 'ipv4'); // reserved, incl. 255.255.255.255
blockedAddresses.addAddress('::', 'ipv6'); // unspecified
blockedAddresses.addSubnet('fe80::', 10, 'ipv6'); // link-local
blockedAddresses.addSubnet('ff00::', 8, 'ipv6'); // multicast
blockedAddresses.addAddress('fd00:ec2::254', 'ipv6'); // AWS instance metadata over IPv6

function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return blockedAddresses.check(address, 'ipv4');
  if (family === 6) return blockedAddresses.check(address, 'ipv6');
  return false;
}

/**
 * Checks a destination against the policy. Runs when the URL is saved and again
 * before every attempt, since a row may predate the current rules.
 */
function checkWebhookUrl(rawUrl: string, allowHttp: boolean): { url: URL } | { errorCode: WebhookUrlErrorCode } {
  if (!rawUrl || rawUrl.length > MAX_WEBHOOK_URL_LENGTH) {
    return { errorCode: 'WEBHOOK_URL_INVALID' };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { errorCode: 'WEBHOOK_URL_INVALID' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { errorCode: 'WEBHOOK_URL_INVALID' };
  }
  if (url.protocol === 'http:' && !allowHttp) {
    return { errorCode: 'WEBHOOK_URL_INSECURE' };
  }

  // IP literals never go through the connect-time lookup, so they are checked
  // here. The URL parser has already normalized forms like 2852039166 or
  // 0251.0376.0251.0376 to dotted IPv4.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedAddress(hostname)) {
    return { errorCode: 'WEBHOOK_URL_BLOCKED' };
  }

  return { url };
}

const URL_ERROR_TO_DELIVERY_ERROR: Record<WebhookUrlErrorCode, WebhookDeliveryError> = {
  WEBHOOK_URL_INVALID: 'invalidUrl',
  WEBHOOK_URL_INSECURE: 'insecureUrl',
  WEBHOOK_URL_BLOCKED: 'blockedAddress',
};

const URL_ERROR_MESSAGES: Record<WebhookUrlErrorCode, string> = {
  WEBHOOK_URL_INVALID: 'Enter a valid http:// or https:// URL.',
  WEBHOOK_URL_INSECURE: 'Plain http:// URLs need "Allow plain HTTP".',
  WEBHOOK_URL_BLOCKED: 'This address is not allowed as a webhook destination.',
};

/**
 * Wraps a DNS lookup so a hostname that resolves to a blocked address fails
 * before the socket connects. The socket then connects to the address checked
 * here, so a rebinding DNS answer cannot swap it afterwards.
 */
function createGuardedLookup(resolveHost: typeof dns.lookup): net.LookupFunction {
  return (hostname, options, callback) => {
    resolveHost(hostname, options, (error, address, family) => {
      if (error) {
        callback(error, address, family);
        return;
      }

      // http.request asks for every address (`all: true`) when it races IPv4
      // and IPv6, and for a single one otherwise.
      const addresses = Array.isArray(address) ? address.map((entry) => entry.address) : [address];
      if (addresses.some((candidate) => isBlockedAddress(candidate))) {
        const blockedError: NodeJS.ErrnoException = new Error('Webhook destination resolves to a blocked address');
        blockedError.code = 'EWEBHOOKBLOCKED';
        callback(blockedError, address, family);
        return;
      }

      callback(null, address, family);
    });
  };
}

function classifyStatus(status: number): AttemptResult {
  if (status >= 200 && status < 300) {
    return { status, error: null, retryable: false };
  }
  if (status >= 300 && status < 400) {
    // Redirects are not followed: the Location is a destination nobody checked.
    return { status, error: 'redirect', retryable: false };
  }
  return { status, error: 'httpStatus', retryable: status === 408 || status === 429 || status >= 500 };
}

function classifyRequestError(error: NodeJS.ErrnoException): AttemptResult {
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === 'EWEBHOOKBLOCKED') {
    return { status: null, error: 'blockedAddress', retryable: false };
  }
  if (/CERT|TLS|SSL|EPROTO|UNABLE_TO_|SIGNATURE/.test(code)) {
    return { status: null, error: 'tls', retryable: false };
  }
  return { status: null, error: 'network', retryable: true };
}

/** Standard Webhooks v1 signature over `<id>.<timestamp>.<body>`. */
function signWebhook(secret: string, eventId: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.slice(WEBHOOK_SECRET_PREFIX.length), 'base64');
  const signature = createHmac('sha256', key).update(`${eventId}.${timestamp}.${body}`).digest('base64');
  return `v1,${signature}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

function readStoredWebhook(userId: number): StoredWebhook | null {
  const row = notificationChannelEndpointsDb.getEndpoint(userId, WEBHOOK_CHANNEL, WEBHOOK_ENDPOINT_ID);
  if (!row) {
    return null;
  }

  const metadata = notificationChannelEndpointsDb.parseMetadata(row.metadata_json);
  const secret = typeof metadata.secret === 'string' && metadata.secret.startsWith(WEBHOOK_SECRET_PREFIX)
    ? metadata.secret
    : null;
  const lastDelivery = metadata.lastDelivery && typeof metadata.lastDelivery === 'object'
    ? metadata.lastDelivery as WebhookDelivery
    : null;

  return {
    url: typeof metadata.url === 'string' ? metadata.url : '',
    allowHttp: metadata.allowHttp === true,
    secret,
    enabled: Boolean(row.enabled),
    label: row.label,
    lastDelivery,
  };
}

function writeStoredWebhook(userId: number, webhook: StoredWebhook): void {
  notificationChannelEndpointsDb.upsertEndpoint({
    userId,
    channel: WEBHOOK_CHANNEL,
    endpointId: WEBHOOK_ENDPOINT_ID,
    label: webhook.label,
    metadata: {
      url: webhook.url,
      allowHttp: webhook.allowHttp,
      ...(webhook.secret ? { secret: webhook.secret } : {}),
      ...(webhook.lastDelivery ? { lastDelivery: webhook.lastDelivery } : {}),
    },
    enabled: webhook.enabled,
  });
}

/** The secret never leaves this module after it is generated; callers see `hasSecret`. */
function toConfigView(webhook: StoredWebhook | null): WebhookConfigView {
  if (!webhook) {
    return { configured: false, enabled: false, url: '', allowHttp: false, hasSecret: false, lastDelivery: null };
  }
  return {
    configured: true,
    enabled: webhook.enabled,
    url: webhook.url,
    allowHttp: webhook.allowHttp,
    hasSecret: Boolean(webhook.secret),
    lastDelivery: webhook.lastDelivery,
  };
}

function requireStoredWebhook(userId: number): StoredWebhook {
  const webhook = readStoredWebhook(userId);
  if (!webhook) {
    throw new AppError('No webhook is configured.', { code: 'WEBHOOK_NOT_CONFIGURED', statusCode: 404 });
  }
  return webhook;
}

/** Maps an orchestrator event to its webhook type, or null for events that are not run lifecycle. */
function describeLifecycleEvent(event: LifecycleEvent): { type: WebhookEventType; outcome: WebhookOutcome } | null {
  switch (event.code) {
    case 'run.stopped':
      return event.meta?.stopReason === 'aborted'
        ? { type: 'run.cancelled', outcome: 'cancelled' }
        : { type: 'run.completed', outcome: 'completed' };
    case 'run.background_completed':
      return { type: 'run.background_completed', outcome: 'completed' };
    case 'run.failed':
      return { type: 'run.failed', outcome: 'failed' };
    default:
      // permission.required and agent.notification are not lifecycle, and the
      // latter carries model text.
      return null;
  }
}

/**
 * Builds the webhook channel. Production uses the defaults through
 * `webhookNotificationsService`; exported so tests can shorten the timeout and
 * backoff and inject DNS answers.
 */
export function createWebhookNotificationsService(overrides: Partial<WebhookNotifierOptions> = {}) {
  const options: WebhookNotifierOptions = { ...DEFAULT_NOTIFIER_OPTIONS, ...overrides };
  const guardedLookup = createGuardedLookup(options.resolveHost);
  // Deliveries still running, so a burst cannot pile up sockets and timers
  // without bound (and so tests can wait for them).
  const inFlight = new Set<Promise<unknown>>();

  function postOnce(url: URL, body: string, headers: Record<string, string>, timeoutMs: number): Promise<AttemptResult> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: AttemptResult) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      const client = url.protocol === 'https:' ? https : http;
      // agent:false = a fresh connection per attempt, closed afterwards. TLS
      // certificates are verified (Node's default; there is no opt-out).
      const request = client.request(url, { method: 'POST', headers, lookup: guardedLookup, agent: false }, (response) => {
        settle(classifyStatus(response.statusCode ?? 0));
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_RESPONSE_BYTES) {
            request.destroy();
          }
        });
        // Destroying mid-body surfaces as an error on the response; it is expected.
        response.on('error', () => {});
      });

      // One budget covers connect, TLS, headers and the drain.
      const timer = setTimeout(() => {
        settle({ status: null, error: 'timeout', retryable: true });
        request.destroy();
      }, timeoutMs);
      timer.unref();

      request.on('error', (error: NodeJS.ErrnoException) => settle(classifyRequestError(error)));
      request.on('close', () => clearTimeout(timer));
      request.end(body);
    });
  }

  async function deliver(target: WebhookTarget, event: WebhookEventBody, maxAttempts: number): Promise<WebhookDelivery> {
    const body = JSON.stringify(event);
    let attempts = 0;
    let result: AttemptResult = { status: null, error: 'invalidUrl', retryable: false };

    while (attempts < maxAttempts) {
      if (attempts > 0) {
        await delay(options.retryDelaysMs[attempts - 1] ?? 0);
      }
      attempts += 1;

      const checked = checkWebhookUrl(target.url, target.allowHttp);
      if ('errorCode' in checked) {
        result = { status: null, error: URL_ERROR_TO_DELIVERY_ERROR[checked.errorCode], retryable: false };
        break;
      }

      // The id and body stay the same on every attempt so receivers can
      // dedupe; the timestamp and signature are per attempt.
      const timestamp = Math.floor(Date.now() / 1000);
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(body)),
        'user-agent': WEBHOOK_USER_AGENT,
        'webhook-id': event.id,
        'webhook-timestamp': String(timestamp),
        connection: 'close',
      };
      if (target.secret) {
        headers['webhook-signature'] = signWebhook(target.secret, event.id, timestamp, body);
      }

      result = await postOnce(checked.url, body, headers, options.attemptTimeoutMs);
      if (!result.error || !result.retryable) {
        break;
      }
    }

    return {
      eventId: event.id,
      type: event.type,
      ok: !result.error,
      status: result.status,
      error: result.error,
      attempts,
      at: new Date().toISOString(),
    };
  }

  /** Stores the outcome for Settings, unless the destination changed or was removed meanwhile. */
  function recordDelivery(userId: number, target: WebhookTarget, delivery: WebhookDelivery): void {
    if (!delivery.ok) {
      let host = '';
      try {
        host = new URL(target.url).host;
      } catch {
        // An unparseable URL has no host worth logging.
      }
      // Never the URL path or query (they can carry tokens), the secret, the
      // signature or a body.
      console.warn('[notifications] webhook delivery failed', {
        eventId: delivery.eventId,
        type: delivery.type,
        attempts: delivery.attempts,
        status: delivery.status,
        error: delivery.error,
        host,
      });
    }

    try {
      const current = readStoredWebhook(userId);
      if (current && current.url === target.url) {
        writeStoredWebhook(userId, { ...current, lastDelivery: delivery });
      }
    } catch (error) {
      console.warn('[notifications] could not record webhook delivery status:', (error as Error)?.message);
    }
  }

  function track<T>(promise: Promise<T>): Promise<T> {
    inFlight.add(promise);
    const forget = () => {
      inFlight.delete(promise);
    };
    void promise.then(forget, forget);
    return promise;
  }

  function startDelivery(userId: number, target: WebhookTarget, event: WebhookEventBody, maxAttempts: number): Promise<WebhookDelivery> {
    if (inFlight.size >= options.maxInFlight) {
      const dropped: WebhookDelivery = {
        eventId: event.id,
        type: event.type,
        ok: false,
        status: null,
        error: 'dropped',
        attempts: 0,
        at: new Date().toISOString(),
      };
      recordDelivery(userId, target, dropped);
      return Promise.resolve(dropped);
    }

    return track(
      deliver(target, event, maxAttempts)
        .catch((): WebhookDelivery => ({
          eventId: event.id,
          type: event.type,
          ok: false,
          status: null,
          error: 'network',
          attempts: 1,
          at: new Date().toISOString(),
        }))
        .then((delivery) => {
          recordDelivery(userId, target, delivery);
          return delivery;
        }),
    );
  }

  return {
    getConfig(userId: number): WebhookConfigView {
      return toConfigView(readStoredWebhook(userId));
    },

    /** Validates and stores the destination. A kept URL keeps its delivery status; the secret is always kept. */
    saveConfig(userId: number, input: { url: string; allowHttp?: boolean; enabled?: boolean }): WebhookConfigView {
      const url = input.url.trim();
      const allowHttp = input.allowHttp === true;
      const checked = checkWebhookUrl(url, allowHttp);
      if ('errorCode' in checked) {
        throw new AppError(URL_ERROR_MESSAGES[checked.errorCode], { code: checked.errorCode, statusCode: 400 });
      }

      const existing = readStoredWebhook(userId);
      const webhook: StoredWebhook = {
        url,
        allowHttp,
        secret: existing?.secret ?? null,
        enabled: input.enabled ?? existing?.enabled ?? true,
        label: existing?.label ?? null,
        lastDelivery: existing && existing.url === url ? existing.lastDelivery : null,
      };
      writeStoredWebhook(userId, webhook);
      return toConfigView(webhook);
    },

    /** Removes the destination, its secret and its delivery status. */
    removeConfig(userId: number): boolean {
      return notificationChannelEndpointsDb.removeEndpoint(userId, WEBHOOK_CHANNEL, WEBHOOK_ENDPOINT_ID);
    },

    /** Generates (or rotates) the signing secret. The only call that ever returns it. */
    createSecret(userId: number): { secret: string; webhook: WebhookConfigView } {
      const webhook = requireStoredWebhook(userId);
      const secret = `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64')}`;
      const updated = { ...webhook, secret };
      writeStoredWebhook(userId, updated);
      return { secret, webhook: toConfigView(updated) };
    },

    removeSecret(userId: number): WebhookConfigView {
      const updated = { ...requireStoredWebhook(userId), secret: null };
      writeStoredWebhook(userId, updated);
      return toConfigView(updated);
    },

    /** Sends one `webhook.test` event (one attempt) and waits for it, enabled or not. */
    async sendTestEvent(userId: number): Promise<{ delivery: WebhookDelivery; webhook: WebhookConfigView }> {
      const webhook = requireStoredWebhook(userId);
      const event: WebhookEventBody = {
        version: WEBHOOK_PAYLOAD_VERSION,
        id: `evt_${randomUUID()}`,
        type: 'webhook.test',
        createdAt: new Date().toISOString(),
        provider: null,
        sessionId: null,
        outcome: null,
        test: true,
      };
      const delivery = await startDelivery(userId, webhook, event, 1);
      return { delivery, webhook: toConfigView(readStoredWebhook(userId)) };
    },

    /**
     * Orchestrator entry point. Returns without I/O for non-lifecycle events and
     * when no enabled destination exists; otherwise starts the delivery in the
     * background. Never throws and the returned promise never rejects.
     */
    sendForEvent({ userId, event }: { userId: number; event: LifecycleEvent }): Promise<WebhookDelivery | null> {
      try {
        const lifecycle = event ? describeLifecycleEvent(event) : null;
        if (!lifecycle) {
          return Promise.resolve(null);
        }

        const webhook = readStoredWebhook(userId);
        if (!webhook || !webhook.enabled || !webhook.url) {
          return Promise.resolve(null);
        }

        const body: WebhookEventBody = {
          version: WEBHOOK_PAYLOAD_VERSION,
          id: `evt_${randomUUID()}`,
          type: lifecycle.type,
          createdAt: typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
          provider: typeof event.provider === 'string' ? event.provider : null,
          sessionId: typeof event.sessionId === 'string' ? event.sessionId : null,
          outcome: lifecycle.outcome,
          test: false,
        };
        return startDelivery(userId, webhook, body, options.retryDelaysMs.length + 1);
      } catch (error) {
        console.warn('[notifications] webhook channel error:', (error as Error)?.message);
        return Promise.resolve(null);
      }
    },

    /** Resolves once every delivery started so far has finished. Used by tests. */
    async waitForIdle(): Promise<void> {
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight]);
      }
    },
  };
}

/**
 * Used by the notification orchestrator (the `webhook` channel) and by
 * notifications.routes (Settings: configure, secret, test event).
 */
export const webhookNotificationsService = createWebhookNotificationsService();
