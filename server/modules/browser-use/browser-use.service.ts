import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

const require = createRequire(import.meta.url);
const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';
const MAX_SESSIONS_PER_OWNER = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER || '3', 10);
const SESSION_TTL_MS = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_SESSION_TTL_MS || String(30 * 60 * 1000), 10);
const ALLOW_PRIVATE_NETWORKS = process.env.CLOUDCLI_BROWSER_USE_ALLOW_PRIVATE_NETWORKS === '1';

type BrowserUseRuntime = 'cloud' | 'local';
type BrowserUseSessionStatus = 'ready' | 'stopped' | 'unavailable';

type BrowserUseSession = {
  id: string;
  ownerId: string;
  runtime: BrowserUseRuntime;
  status: BrowserUseSessionStatus;
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
};

type PublicBrowserUseSession = Omit<BrowserUseSession, 'ownerId'>;

type RuntimeHandle = {
  browser?: any;
  page?: any;
};

type BrowserUseOwner = {
  id: string | number;
};

const sessions = new Map<string, BrowserUseSession>();
const handles = new Map<string, RuntimeHandle>();

function getRuntime(): BrowserUseRuntime {
  return IS_PLATFORM ? 'cloud' : 'local';
}

function isBrowserUseEnabled(): boolean {
  return process.env.CLOUDCLI_BROWSER_USE_ENABLED === '1';
}

function getSetupMessage(): string {
  if (!isBrowserUseEnabled()) {
    return 'Browser Use is disabled. Set CLOUDCLI_BROWSER_USE_ENABLED=1 after provisioning a Playwright/Chromium runtime.';
  }

  return 'Playwright is not available in this runtime. Install/provision Playwright or point CloudCLI at a managed browser worker.';
}

function getPlaywright(): any | null {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

function getOwnerId(owner: BrowserUseOwner): string {
  if (owner.id === undefined || owner.id === null || String(owner.id).trim() === '') {
    throw new Error('Authenticated user is required.');
  }

  return String(owner.id);
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168)
    || first >= 224;
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.')
    || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
    || /^::ffff:169\.254\./.test(normalized);
}

export function isBlockedBrowserUseAddress(address: string): boolean {
  const version = net.isIP(address);
  if (version === 4) {
    return isPrivateIpv4(address);
  }
  if (version === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

async function assertPublicHttpTarget(parsedUrl: URL): Promise<void> {
  if (ALLOW_PRIVATE_NETWORKS) {
    return;
  }

  const hostname = parsedUrl.hostname;
  if (!hostname) {
    throw new Error('URL hostname is required.');
  }

  if (net.isIP(hostname)) {
    if (isBlockedBrowserUseAddress(hostname)) {
      throw new Error('Browser Use cannot navigate to private or local network addresses.');
    }
    return;
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isBlockedBrowserUseAddress(entry.address))) {
    throw new Error('Browser Use cannot navigate to private or local network addresses.');
  }
}

async function normalizeUrl(rawUrl: string): Promise<string> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error('URL is required.');
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported.');
  }

  await assertPublicHttpTarget(parsed);

  return parsed.toString();
}

async function assertAllowedBrowserRequest(rawUrl: string): Promise<void> {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return;
  }

  await assertPublicHttpTarget(parsed);
}

async function attachRequestGuard(page: any): Promise<void> {
  await page.route('**/*', async (route: any) => {
    try {
      await assertAllowedBrowserRequest(route.request().url());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  });
}

function publicSession(session: BrowserUseSession): PublicBrowserUseSession {
  const { ownerId: _ownerId, ...publicFields } = session;
  return publicFields;
}

function ownerSessions(ownerId: string): BrowserUseSession[] {
  return [...sessions.values()].filter((session) => session.ownerId === ownerId);
}

async function closeHandle(sessionId: string): Promise<void> {
  const handle = handles.get(sessionId);
  handles.delete(sessionId);
  await handle?.browser?.close().catch(() => undefined);
}

async function expireStaleSessions(now = Date.now()): Promise<void> {
  await Promise.all([...sessions.values()].map(async (session) => {
    if (session.status !== 'ready') {
      return;
    }

    const updatedAt = Date.parse(session.updatedAt);
    if (!Number.isFinite(updatedAt) || now - updatedAt <= SESSION_TTL_MS) {
      return;
    }

    await closeHandle(session.id);
    session.status = 'stopped';
    session.updatedAt = new Date(now).toISOString();
    session.lastAction = 'expire';
    session.message = 'Browser session expired after inactivity.';
  }));
}

async function captureSession(session: BrowserUseSession, page: any): Promise<void> {
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false });
  session.screenshotDataUrl = `data:image/jpeg;base64,${Buffer.from(screenshot).toString('base64')}`;
  session.title = await page.title().catch(() => null);
  session.url = page.url() || session.url;
  session.updatedAt = new Date().toISOString();
}

export const browserUseService = {
  getStatus() {
    const playwright = getPlaywright();
    const enabled = isBrowserUseEnabled() && Boolean(playwright);

    return {
      enabled,
      runtime: getRuntime(),
      available: enabled,
      sessionCount: sessions.size,
      mcpRecommended: true,
      message: enabled
        ? 'Browser Use runtime is available.'
        : getSetupMessage(),
    };
  },

  async listSessions(owner: BrowserUseOwner) {
    const ownerId = getOwnerId(owner);
    await expireStaleSessions();
    return ownerSessions(ownerId).map(publicSession);
  },

  async createSession(owner: BrowserUseOwner) {
    const ownerId = getOwnerId(owner);
    await expireStaleSessions();

    const now = new Date().toISOString();
    const session: BrowserUseSession = {
      id: randomUUID(),
      ownerId,
      runtime: getRuntime(),
      status: 'unavailable',
      url: null,
      title: null,
      screenshotDataUrl: null,
      createdAt: now,
      updatedAt: now,
      lastAction: 'create',
      message: null,
    };

    const activeOwnerSessions = ownerSessions(ownerId).filter((item) => item.status === 'ready');
    if (activeOwnerSessions.length >= MAX_SESSIONS_PER_OWNER) {
      throw new Error(`Browser Use is limited to ${MAX_SESSIONS_PER_OWNER} active sessions per user.`);
    }

    const playwright = getPlaywright();
    if (!isBrowserUseEnabled() || !playwright) {
      session.message = getSetupMessage();
      sessions.set(session.id, session);
      return publicSession(session);
    }

    const browser = await playwright.chromium.launch({
      headless: true,
      args: ['--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await attachRequestGuard(page);
    session.status = 'ready';
    session.message = 'Browser session is ready.';
    sessions.set(session.id, session);
    handles.set(session.id, { browser, page });
    await captureSession(session, page);
    return publicSession(session);
  },

  async navigate(owner: BrowserUseOwner, sessionId: string, rawUrl: string) {
    const ownerId = getOwnerId(owner);
    await expireStaleSessions();

    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) {
      throw new Error('Browser session not found.');
    }

    if (session.status !== 'ready') {
      throw new Error(session.message || 'Browser session is not available.');
    }

    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }

    const url = await normalizeUrl(rawUrl);
    await handle.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    session.lastAction = `navigate:${url}`;
    await captureSession(session, handle.page);
    return publicSession(session);
  },

  async stopSession(owner: BrowserUseOwner, sessionId: string) {
    const ownerId = getOwnerId(owner);
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== ownerId) {
      return { stopped: false };
    }

    await closeHandle(sessionId);

    session.status = 'stopped';
    session.updatedAt = new Date().toISOString();
    session.lastAction = 'stop';
    session.message = 'Browser session stopped.';
    return { stopped: true, session: publicSession(session) };
  },

  async stopAllSessions() {
    await Promise.all([...sessions.keys()].map(async (sessionId) => {
      await closeHandle(sessionId);
      const session = sessions.get(sessionId);
      if (session) {
        session.status = 'stopped';
        session.updatedAt = new Date().toISOString();
        session.lastAction = 'shutdown';
        session.message = 'Browser session stopped during server shutdown.';
      }
    }));
  },
};

process.once('beforeExit', () => {
  void browserUseService.stopAllSessions();
});
