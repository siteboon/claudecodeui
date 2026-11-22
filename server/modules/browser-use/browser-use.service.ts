import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// cross-spawn: drop-in spawn with Windows .cmd/PATHEXT resolution.
import spawn from 'cross-spawn';

import { appConfigDb } from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/index.js';
import { AppError, getModuleDirectory } from '@/shared/utils.js';

import { getBrowserUseRuntime } from './browser-use-runtime.js';

const require = createRequire(import.meta.url);
const __dirname = getModuleDirectory(import.meta.url);
const MAX_SESSIONS_PER_OWNER = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER || '3', 10);
const SESSION_TTL_MS = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_SESSION_TTL_MS || String(30 * 60 * 1000), 10);
const BROWSER_USE_SETTINGS_KEY = 'browser_use_settings';
const BROWSER_USE_MCP_TOKEN_KEY = 'browser_use_mcp_token';
const CONTROL_LEASE_MS = 15_000;

type BrowserUseRuntime = ReturnType<typeof getBrowserUseRuntime>;
type BrowserUseSessionStatus = 'ready' | 'stopped' | 'unavailable';

type BrowserUseSession = {
  id: string;
  ownerId: string;
  control?: { id: string; expiresAt: number; frameAt: number };
  createdBy: 'agent';
  runtime: BrowserUseRuntime;
  status: BrowserUseSessionStatus;
  url: string | null;
  title: string | null;
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  profileName: string | null;
  viewport: {
    width: number;
    height: number;
  } | null;
  cursor: {
    x: number;
    y: number;
    actor: 'agent';
  } | null;
};

type PublicBrowserUseSession = Omit<BrowserUseSession, 'ownerId' | 'control'> & { userControlled: boolean };
type LiveInput =
  | { type: 'pointer'; x: number; y: number; to?: { x: number; y: number } }
  | { type: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string };

type RuntimeHandle = {
  browser?: any;
  context?: any;
  page?: any;
};

type BrowserUseSettings = {
  enabled: boolean;
};

type RuntimeReadiness = {
  playwright: any | null;
  playwrightInstalled: boolean;
  chromiumInstalled: boolean;
  chromiumExecutablePath: string | null;
  installInProgress: boolean;
  installMessage: string | null;
};

type RuntimeProbe = Omit<RuntimeReadiness, 'installInProgress' | 'installMessage'>;

const sessions = new Map<string, BrowserUseSession>();
const handles = new Map<string, RuntimeHandle>();

const sessionLocks = new Map<string, Promise<unknown>>();

/**
 * Runs page actions for one session one at a time. Agent and panel actions share the same
 * page, so without this a Tab from the agent could move focus while the user's text is
 * being typed, and an older screenshot could overwrite a newer one.
 */
function withSessionLock<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
  const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
  const run = previous.then(action, action);
  const tail = run.catch(() => undefined);
  sessionLocks.set(sessionId, tail);
  void tail.then(() => {
    if (sessionLocks.get(sessionId) === tail) sessionLocks.delete(sessionId);
  });
  return run;
}
let installPromise: Promise<{ success: boolean; message: string }> | null = null;
let lastInstallMessage: string | null = null;
let runtimeProbeCache: { value: RuntimeProbe; updatedAt: number } | null = null;

const DEFAULT_SETTINGS: BrowserUseSettings = {
  enabled: false,
};
const AGENT_OWNER_ID = 'agent';
const PROFILE_ROOT = path.join(os.homedir(), '.cloudcli', 'browser-use', 'profiles');
const MCP_SERVER_NAME = 'cloudcli-browser';
const LEGACY_MCP_SERVER_NAMES = ['cloudcli-browser-use'];
const RUNTIME_READINESS_CACHE_TTL_MS = 30_000;

function readSettings(): BrowserUseSettings {
  try {
    const raw = appConfigDb.get(BROWSER_USE_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<BrowserUseSettings>;
    return {
      enabled: parsed.enabled === true,
    };
  } catch (error: any) {
    console.warn('[Browser] Failed to read settings:', error?.message || error);
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: BrowserUseSettings): BrowserUseSettings {
  const normalized = {
    enabled: settings.enabled === true,
  };

  appConfigDb.set(BROWSER_USE_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

function getOrCreateMcpToken(): string {
  const existing = appConfigDb.get(BROWSER_USE_MCP_TOKEN_KEY);
  if (existing) {
    return existing;
  }
  const token = randomBytes(32).toString('hex');
  appConfigDb.set(BROWSER_USE_MCP_TOKEN_KEY, token);
  return token;
}

function getSetupMessage(settings: BrowserUseSettings, readiness: RuntimeReadiness): string {
  if (!settings.enabled) {
    return 'Browser is disabled in settings.';
  }

  if (!readiness.playwrightInstalled) {
    return 'Install Playwright and Chromium to use browser sessions.';
  }

  if (!readiness.chromiumInstalled) {
    return 'Playwright is installed, but Chromium is missing. Install the Chromium runtime to continue.';
  }

  return readiness.installMessage || 'Browser runtime is not ready.';
}

function getPlaywright(): any | null {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

function getMcpCommand(): { command: string; args: string[] } {
  const mcpScriptPath = path.join(__dirname, 'browser-use-mcp.js');
  if (fs.existsSync(mcpScriptPath)) {
    return {
      command: process.execPath,
      args: [mcpScriptPath],
    };
  }

  return {
    command: 'cloudcli',
    args: ['browser-use-mcp'],
  };
}

function getMcpApiUrl(): string {
  const port = process.env.SERVER_PORT || process.env.PORT || '3001';
  return `http://127.0.0.1:${port}/api/browser-use-mcp`;
}

async function removeMcpServerFromAllProviders(name: string) {
  const results = await providerMcpService.removeMcpServerFromAllProviders({
    name,
    scope: 'user',
  });
  return results.map((result) => ({ ...result, name }));
}

function normalizeProfileName(profileName?: string | null): string | null {
  const normalized = String(profileName || '').trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 80);
}

function getProfilePath(profileName: string): string {
  const safeName = profileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'default';
  return path.join(PROFILE_ROOT, safeName);
}

function probeRuntime(): RuntimeProbe {
  const playwright = getPlaywright();
  const readiness: RuntimeProbe = {
    playwright,
    playwrightInstalled: Boolean(playwright),
    chromiumInstalled: false,
    chromiumExecutablePath: null,
  };

  if (!playwright) {
    return readiness;
  }

  try {
    const executablePath = playwright.chromium.executablePath();
    readiness.chromiumExecutablePath = executablePath;
    readiness.chromiumInstalled = Boolean(executablePath && fs.existsSync(executablePath));
  } catch {
    readiness.chromiumInstalled = false;
  }

  return readiness;
}

function getRuntimeReadiness(options: { force?: boolean } = {}): RuntimeReadiness {
  const now = Date.now();
  const cachedProbe = runtimeProbeCache;
  const canUseCache = !options.force
    && !installPromise
    && cachedProbe
    && now - cachedProbe.updatedAt < RUNTIME_READINESS_CACHE_TTL_MS;
  const probe = canUseCache ? cachedProbe.value : probeRuntime();

  if (!canUseCache && !installPromise) {
    runtimeProbeCache = { value: probe, updatedAt: now };
  }

  return {
    ...probe,
    installInProgress: Boolean(installPromise),
    installMessage: lastInstallMessage,
  };
}

const INSTALL_COMMAND_TIMEOUT_MS = Number.parseInt(
  process.env.CLOUDCLI_BROWSER_USE_INSTALL_TIMEOUT_MS || String(10 * 60 * 1000),
  10,
);

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(
        `${command} ${args.join(' ')} timed out after ${INSTALL_COMMAND_TIMEOUT_MS}ms.`,
      )));
    }, INSTALL_COMMAND_TIMEOUT_MS);
    timer.unref?.();

    // stdio config above guarantees the pipes exist; cross-spawn's types
    // just don't narrow them the way node's spawn overloads do.
    child.stdout?.on('data', (chunk) => output.push(String(chunk)));
    child.stderr?.on('data', (chunk) => output.push(String(chunk)));
    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', (code) => finish(() => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(output.join('').trim() || `${command} ${args.join(' ')} exited with code ${code}`));
    }));
  });
}

function formatInstallError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('sudo') && message.includes('password')) {
    return 'Installing Chromium system dependencies requires administrator privileges. Run `npx playwright install-deps chromium` on the machine where CloudCLI runs, then try again.';
  }
  return message || 'Failed to install Browser runtime.';
}

async function installRuntime(): Promise<{ success: boolean; message: string }> {
  if (installPromise) {
    return installPromise;
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  runtimeProbeCache = null;
  installPromise = (async () => {
    try {
      lastInstallMessage = 'Installing Playwright package...';
      await runCommand(npmCommand, ['install', '--no-save', '--no-package-lock', 'playwright']);

      if (process.platform === 'linux') {
        lastInstallMessage = 'Installing Chromium system dependencies...';
        await runCommand(npmCommand, ['exec', '--', 'playwright', 'install-deps', 'chromium']);
      }

      lastInstallMessage = 'Installing Chromium runtime...';
      await runCommand(npmCommand, ['exec', '--', 'playwright', 'install', 'chromium']);

      lastInstallMessage = 'Browser runtime installed.';
      return { success: true, message: lastInstallMessage };
    } catch (error) {
      lastInstallMessage = formatInstallError(error);
      return { success: false, message: lastInstallMessage };
    }
  })();

  try {
    return await installPromise;
  } finally {
    installPromise = null;
    runtimeProbeCache = null;
  }
}

function normalizeUrl(rawUrl: string): string {
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

  return parsed.toString();
}

const MAX_UPLOAD_FILES = 10;
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Validates file paths an agent wants to attach to a page's file input.
 * Only absolute paths to existing regular files within the size cap are accepted, and symlinks are
 * resolved so the size/type checks apply to the real target.
 */
function resolveUploadFiles(rawPaths: string[]): string[] {
  if (rawPaths.length === 0) {
    throw new Error('Provide at least one file path.');
  }
  if (rawPaths.length > MAX_UPLOAD_FILES) {
    throw new Error(`At most ${MAX_UPLOAD_FILES} files can be uploaded at once.`);
  }
  return rawPaths.map((rawPath) => {
    if (!path.isAbsolute(rawPath)) {
      throw new Error(`File path must be absolute: ${rawPath}`);
    }
    let realPath: string;
    let stat: fs.Stats;
    try {
      realPath = fs.realpathSync(rawPath);
      stat = fs.statSync(realPath);
    } catch {
      throw new Error(`File not found: ${rawPath}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Not a regular file: ${rawPath}`);
    }
    if (stat.size > MAX_UPLOAD_FILE_BYTES) {
      throw new Error(`File is larger than ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)} MB: ${rawPath}`);
    }
    return realPath;
  });
}

function publicSession(session: BrowserUseSession): PublicBrowserUseSession {
  const { ownerId: _ownerId, control, ...publicFields } = session;
  return {
    ...publicFields,
    userControlled: Boolean(control),
    ...(control ? { screenshotDataUrl: null, url: null, title: null, cursor: null } : {}),
  };
}

// An expired controller can be replaced, but does not unpause the agent.
function getControlledPage(sessionId: string, controlId?: string) {
  const session = sessions.get(sessionId);
  const page = handles.get(sessionId)?.page;
  if (!readSettings().enabled || session?.status !== 'ready' || !page) {
    throw new AppError('Browser session is not available.', { code: 'BROWSER_USE_CONTROL_LOST', statusCode: 409 });
  }
  if (controlId !== undefined && (session.control?.id !== controlId || session.control.expiresAt <= Date.now())) {
    throw new AppError('Browser control expired or was released. Take control again to continue.', { code: 'BROWSER_USE_CONTROL_LOST', statusCode: 409 });
  }
  return { session, page };
}

function ownerSessions(ownerId: string): BrowserUseSession[] {
  return [...sessions.values()].filter((session) => session.ownerId === ownerId);
}

async function closeHandle(sessionId: string): Promise<void> {
  const handle = handles.get(sessionId);
  handles.delete(sessionId);
  await handle?.context?.close?.().catch(() => undefined);
  await handle?.browser?.close().catch(() => undefined);
}

async function stopLocked(session: BrowserUseSession) {
  await closeHandle(session.id);
  delete session.control;
  session.status = 'stopped';
  session.updatedAt = new Date().toISOString();
  session.lastAction = 'stop';
  session.message = 'Browser session stopped. Create a new session to continue browsing.';
  return { stopped: true, session: publicSession(session) };
}

async function expireStaleSessions(now = Date.now()): Promise<void> {
  const isStale = (session: BrowserUseSession) =>
    session.status === 'ready' && now - Date.parse(session.updatedAt) > SESSION_TTL_MS;
  await Promise.all([...sessions.values()].filter(isStale).map((session) => withSessionLock(session.id, async () => {
    if (!isStale(session)) return;
    await closeHandle(session.id);
    delete session.control;
    session.status = 'stopped';
    session.updatedAt = new Date(now).toISOString();
    session.lastAction = 'expire';
    session.message = 'Browser session expired after inactivity.';
  })));
}

/** Caller must hold the session lock for `session.id`. */
async function navigateLocked(session: BrowserUseSession, handle: RuntimeHandle, rawUrl: string): Promise<void> {
  const url = normalizeUrl(rawUrl);
  await handle.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  session.lastAction = `navigate:${url}`;
  session.cursor = null;
}

async function captureSession(session: BrowserUseSession, page: any): Promise<void> {
  const screenshot = await page.screenshot({ type: 'jpeg', quality: 72, fullPage: false });
  session.screenshotDataUrl = `data:image/jpeg;base64,${Buffer.from(screenshot).toString('base64')}`;
  session.title = await page.title().catch(() => null);
  session.url = page.url() || session.url;
  session.viewport = page.viewportSize?.() || session.viewport;
  session.updatedAt = new Date().toISOString();
}

async function getActionPoint(page: any, input: { selector?: string; text?: string; x?: number; y?: number }) {
  if (typeof input.x === 'number' && typeof input.y === 'number') {
    return { x: input.x, y: input.y };
  }

  const locator = input.selector
    ? page.locator(input.selector).first()
    : input.text
      ? page.getByText(input.text, { exact: false }).first()
      : null;

  if (!locator) {
    return null;
  }

  const box = await locator.boundingBox().catch(() => null);
  if (!box) {
    return null;
  }

  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  };
}

export const browserUseService = {
  async getSettings() {
    return readSettings();
  },

  async updateSettings(settings: Partial<BrowserUseSettings>) {
    const current = readSettings();
    const nextSettings = {
      enabled: typeof settings.enabled === 'boolean' ? settings.enabled : current.enabled,
    };

    const next = writeSettings(nextSettings);
    if (next.enabled) {
      await this.registerAgentMcp();
    } else if (current.enabled) {
      await this.unregisterAgentMcp();
      await this.stopAllSessions();
    }
    return next;
  },

  async getStatus() {
    const settings = readSettings();
    const readiness = getRuntimeReadiness();
    const available = settings.enabled && readiness.playwrightInstalled && readiness.chromiumInstalled;

    return {
      enabled: settings.enabled,
      runtime: getBrowserUseRuntime(),
      available,
      playwrightInstalled: readiness.playwrightInstalled,
      chromiumInstalled: readiness.chromiumInstalled,
      installInProgress: readiness.installInProgress,
      sessionCount: sessions.size,
      message: available
        ? 'Browser runtime is available.'
        : getSetupMessage(settings, readiness),
    };
  },

  async registerAgentMcp() {
    const { command, args } = getMcpCommand();
    await Promise.all(LEGACY_MCP_SERVER_NAMES.map((name) => removeMcpServerFromAllProviders(name)));
    const results = await providerMcpService.addMcpServerToAllProviders({
      name: MCP_SERVER_NAME,
      scope: 'user',
      transport: 'stdio',
      command,
      args,
      env: {
        CLOUDCLI_BROWSER_USE_MCP_TOKEN: getOrCreateMcpToken(),
        CLOUDCLI_BROWSER_USE_API_URL: getMcpApiUrl(),
      },
    });
    return { name: MCP_SERVER_NAME, command, args, results };
  },

  getMcpToken() {
    return getOrCreateMcpToken();
  },

  async unregisterAgentMcp() {
    const results = (await Promise.all(
      [MCP_SERVER_NAME, ...LEGACY_MCP_SERVER_NAMES].map((name) => removeMcpServerFromAllProviders(name)),
    )).flat();
    return { name: MCP_SERVER_NAME, results };
  },

  async installRuntime() {
    const result = await installRuntime();
    return {
      ...result,
      status: await this.getStatus(),
    };
  },

  async listSessions() {
    await expireStaleSessions();
    return [...sessions.values()]
      .filter((session) => session.ownerId === AGENT_OWNER_ID)
      .map(publicSession);
  },

  async createAgentSession(options?: { profileName?: string | null }) {
    const settings = readSettings();
    if (!settings.enabled) {
      throw new Error('Browser agent tools are disabled.');
    }

    await expireStaleSessions();
    const profileName = normalizeProfileName(options?.profileName);

    const now = new Date().toISOString();
    const session: BrowserUseSession = {
      id: randomUUID(),
      ownerId: AGENT_OWNER_ID,
      createdBy: 'agent',
      runtime: getBrowserUseRuntime(),
      status: 'unavailable',
      url: null,
      title: null,
      screenshotDataUrl: null,
      createdAt: now,
      updatedAt: now,
      lastAction: 'create',
      message: null,
      profileName,
      viewport: { width: 1440, height: 900 },
      cursor: null,
    };

    const activeOwnerSessions = ownerSessions(AGENT_OWNER_ID).filter((item) => item.status === 'ready');
    if (activeOwnerSessions.length >= MAX_SESSIONS_PER_OWNER) {
      throw new Error(`Browser is limited to ${MAX_SESSIONS_PER_OWNER} active agent sessions.`);
    }

    const readiness = getRuntimeReadiness();
    if (!settings.enabled || !readiness.playwrightInstalled || !readiness.chromiumInstalled || !readiness.playwright) {
      session.message = getSetupMessage(settings, readiness);
      sessions.set(session.id, session);
      return publicSession(session);
    }

    let browser: any | undefined;
    let context: any | undefined;
    let page: any;
    const launchOptions = {
      headless: true,
      args: ['--disable-dev-shm-usage'],
    };
    const contextOptions = {
      viewport: { width: 1440, height: 900 },
      serviceWorkers: 'block',
    };

    if (profileName) {
      fs.mkdirSync(PROFILE_ROOT, { recursive: true });
      context = await readiness.playwright.chromium.launchPersistentContext(getProfilePath(profileName), {
        ...launchOptions,
        ...contextOptions,
      });
      page = context.pages()[0] || await context.newPage();
    } else {
      browser = await readiness.playwright.chromium.launch(launchOptions);
      context = await browser.newContext(contextOptions);
      page = await context.newPage();
    }
    session.status = 'ready';
    session.message = 'Browser session is ready.';
    sessions.set(session.id, session);
    handles.set(session.id, { browser, context, page });
    await captureSession(session, page);
    return publicSession(session);
  },

  async listAgentSessions() {
    const settings = readSettings();
    if (!settings.enabled) {
      return [];
    }
    await expireStaleSessions();
    return [...sessions.values()]
      .filter((session) => session.ownerId === AGENT_OWNER_ID)
      .map(publicSession);
  },

  async getAgentSession(sessionId: string) {
    const settings = readSettings();
    if (!settings.enabled) {
      throw new Error('Browser agent tools are disabled.');
    }
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== AGENT_OWNER_ID) {
      throw new Error('Browser session not found.');
    }
    if (session.control) {
      throw new Error('The user has taken control of this browser. Wait for the user to return control.');
    }
    return session;
  },

  async agentNavigate(sessionId: string, rawUrl: string) {
    await expireStaleSessions();
    return withSessionLock(sessionId, async () => {
      await this.getAgentSession(sessionId);

      const session = sessions.get(sessionId);
      if (!session || session.ownerId !== AGENT_OWNER_ID) {
        throw new Error('Browser session not found.');
      }

      if (session.status !== 'ready') {
        throw new Error(session.message || 'Browser session is not available.');
      }

      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }

      await navigateLocked(session, handle, rawUrl);
      await captureSession(session, handle.page);
      return publicSession(session);
    });
  },

  async agentSnapshot(sessionId: string) {
    return withSessionLock(sessionId, async () => {
      const session = await this.getAgentSession(sessionId);
      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }
      await captureSession(session, handle.page);
      const text = await handle.page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
      return {
        session: publicSession(session),
        text: text.slice(0, 30_000),
      };
    });
  },

  async agentClick(sessionId: string, input: { selector?: string; text?: string; x?: number; y?: number }) {
    return withSessionLock(sessionId, async () => {
      const session = await this.getAgentSession(sessionId);
      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }
      const point = await getActionPoint(handle.page, input);

      if (input.selector) {
        await handle.page.locator(input.selector).first().click({ timeout: 10_000 });
      } else if (input.text) {
        await handle.page.getByText(input.text, { exact: false }).first().click({ timeout: 10_000 });
      } else if (typeof input.x === 'number' && typeof input.y === 'number') {
        await handle.page.mouse.click(input.x, input.y);
      } else {
        throw new Error('Provide selector, text, or x/y coordinates.');
      }

      session.lastAction = 'click';
      session.cursor = point ? { ...point, actor: 'agent' } : null;
      await captureSession(session, handle.page);
      return publicSession(session);
    });
  },

  async agentType(sessionId: string, input: { selector?: string; text: string; submit?: boolean }) {
    return withSessionLock(sessionId, async () => {
      const session = await this.getAgentSession(sessionId);
      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }

      if (input.selector) {
        await handle.page.locator(input.selector).first().fill(input.text, { timeout: 10_000 });
        session.cursor = await getActionPoint(handle.page, input).then((point) => (
          point ? { ...point, actor: 'agent' as const } : null
        ));
      } else {
        await handle.page.keyboard.type(input.text);
      }
      if (input.submit) {
        await handle.page.keyboard.press('Enter');
      }

      session.lastAction = 'type';
      await captureSession(session, handle.page);
      return publicSession(session);
    });
  },

  async agentFillForm(sessionId: string, fields: Array<{ selector: string; value: string }>) {
    return withSessionLock(sessionId, async () => {
      const session = await this.getAgentSession(sessionId);
      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }
      for (const field of fields) {
        await handle.page.locator(field.selector).first().fill(field.value, { timeout: 10_000 });
      }
      session.lastAction = 'fill_form';
      if (fields[0]) {
        session.cursor = await getActionPoint(handle.page, { selector: fields[0].selector }).then((point) => (
          point ? { ...point, actor: 'agent' as const } : null
        ));
      }
      await captureSession(session, handle.page);
      return publicSession(session);
    });
  },

  async agentPressKey(sessionId: string, key: string) {
    return withSessionLock(sessionId, async () => {
      const session = await this.getAgentSession(sessionId);
      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }
      await handle.page.keyboard.press(key);
      session.lastAction = `press_key:${key}`;
      await captureSession(session, handle.page);
      return publicSession(session);
    });
  },

  async agentSelectOption(sessionId: string, selector: string, values: string[]) {
    return withSessionLock(sessionId, async () => {
      const session = await this.getAgentSession(sessionId);
      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }
      await handle.page.locator(selector).first().selectOption(values, { timeout: 10_000 });
      session.lastAction = 'select_option';
      session.cursor = await getActionPoint(handle.page, { selector }).then((point) => (
        point ? { ...point, actor: 'agent' as const } : null
      ));
      await captureSession(session, handle.page);
      return publicSession(session);
    });
  },

  async agentUploadFiles(sessionId: string, input: { selector?: string; paths: string[] }) {
    // Validate the files first so bad input fails fast, before taking the session lock.
    const files = resolveUploadFiles(input.paths);
    return withSessionLock(sessionId, async () => {
      const session = await this.getAgentSession(sessionId);
      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }
      const selector = input.selector || 'input[type="file"]';
      // setInputFiles works on hidden inputs too, which is how most upload widgets are built.
      await handle.page.locator(selector).first().setInputFiles(files, { timeout: 10_000 });
      session.lastAction = `upload_files:${files.length}`;
      await captureSession(session, handle.page);
      return { session: publicSession(session), uploaded: files.map((file) => path.basename(file)) };
    });
  },

  async agentWaitFor(sessionId: string, input: { text?: string; url?: string; timeoutMs?: number }) {
    return withSessionLock(sessionId, async () => {
      const session = await this.getAgentSession(sessionId);
      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }
      const timeout = Math.max(250, Math.min(input.timeoutMs || 5_000, 30_000));
      if (input.text) {
        await handle.page.getByText(input.text, { exact: false }).first().waitFor({ timeout });
      } else if (input.url) {
        await handle.page.waitForURL(input.url, { timeout });
      } else {
        await handle.page.waitForTimeout(timeout);
      }
      session.lastAction = 'wait_for';
      await captureSession(session, handle.page);
      return publicSession(session);
    });
  },

  async agentTabs(sessionId: string, input: { action?: 'list' | 'new' | 'select' | 'close'; index?: number; url?: string }) {
    return withSessionLock(sessionId, async () => {
      const session = await this.getAgentSession(sessionId);
      const handle = handles.get(sessionId);
      if (!handle?.context || !handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }
      const action = input.action || 'list';
      if (action === 'new') {
        const page = await handle.context.newPage();
        const newHandle = { ...handle, page };
        handles.set(sessionId, newHandle);
        if (input.url) {
          // Not agentNavigate: it would wait on the session lock this call already holds.
          await navigateLocked(session, newHandle, input.url);
        }
      } else if (action === 'select') {
        const page = handle.context.pages()[input.index || 0];
        if (!page) {
          throw new Error('Tab not found.');
        }
        handles.set(sessionId, { ...handle, page });
      } else if (action === 'close') {
        const pages = handle.context.pages();
        const page = pages[input.index ?? pages.indexOf(handle.page)];
        if (!page) {
          throw new Error('Tab not found.');
        }
        await page.close();
        handles.set(sessionId, { ...handle, page: handle.context.pages()[0] || await handle.context.newPage() });
      }
      const updatedHandle = handles.get(sessionId);
      await captureSession(session, updatedHandle?.page || handle.page);
      return {
        session: publicSession(session),
        tabs: handle.context.pages().map((page: any, index: number) => ({
          index,
          url: page.url(),
          active: page === (updatedHandle?.page || handle.page),
        })),
      };
    });
  },

  /** Used by Browser routes to reserve the existing Chromium page for a single viewer. */
  async takeControl(sessionId: string) {
    return withSessionLock(sessionId, async () => {
      const { session } = getControlledPage(sessionId);
      const now = Date.now();
      if (session.control && session.control.expiresAt > now) {
        throw new Error('Another viewer already controls this browser.');
      }
      const id = randomUUID();
      session.control = { id, expiresAt: now + CONTROL_LEASE_MS, frameAt: 0 };
      session.updatedAt = new Date(now).toISOString();
      return { controlId: id };
    });
  },

  /** Used only by the authenticated viewer. Its images never enter the agent screenshot cache. */
  async controlFrame(sessionId: string, controlId: string) {
    return withSessionLock(sessionId, async () => {
      const { session, page } = getControlledPage(sessionId, controlId);
      const control = session.control!;
      const now = Date.now();
      if (now - control.frameAt < 200) return null;
      control.frameAt = now;
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 2_000 });
      control.expiresAt = Date.now() + CONTROL_LEASE_MS;
      session.updatedAt = new Date().toISOString();
      return `data:image/jpeg;base64,${Buffer.from(screenshot).toString('base64')}`;
    });
  },

  /** Used by Browser routes to forward validated viewer input to the same Chromium page. */
  async controlInput(sessionId: string, controlId: string, input: LiveInput) {
    return withSessionLock(sessionId, async () => {
      const { session, page } = getControlledPage(sessionId, controlId);
      const viewport = page.viewportSize() || session.viewport;
      if (input.type === 'text') {
        await page.keyboard.insertText(input.text);
      } else if (input.type === 'key') {
        await page.keyboard.press(input.key);
      } else if (viewport) {
        const x = input.x * (viewport.width - 1);
        const y = input.y * (viewport.height - 1);
        if (input.type === 'wheel') {
          await page.mouse.move(x, y);
          await page.mouse.wheel(input.dx, input.dy);
        } else if (input.to) {
          await page.mouse.move(x, y);
          await page.mouse.down();
          try {
            await page.mouse.move(input.to.x * (viewport.width - 1), input.to.y * (viewport.height - 1), { steps: 12 });
          } finally {
            await page.mouse.up();
          }
        } else {
          await page.mouse.click(x, y);
        }
      }
    });
  },

  /** Used by Browser routes to explicitly return control to agent tools. */
  async releaseControl(sessionId: string, controlId: string) {
    return withSessionLock(sessionId, async () => {
      const { session } = getControlledPage(sessionId, controlId);
      delete session.control;
    });
  },

  /** Lets the signed-in user send one-shot input outside a live takeover. */
  async userInput(
    sessionId: string,
    input: { type: 'click'; x: number; y: number } | { type: 'text'; text: string } | { type: 'key'; key: string },
  ) {
    return withSessionLock(sessionId, async () => {
      const session = sessions.get(sessionId);
      if (!session || session.ownerId !== AGENT_OWNER_ID) {
        throw new Error('Browser session not found.');
      }
      if (session.status !== 'ready') {
        throw new Error(session.message || 'Browser session is not available.');
      }
      if (session.control) {
        throw new Error('Use the live viewer to control this browser.');
      }
      const handle = handles.get(sessionId);
      if (!handle?.page) {
        throw new Error('Browser runtime handle is not available.');
      }

      if (input.type === 'click') {
        await handle.page.mouse.click(input.x, input.y);
      } else if (input.type === 'text') {
        await handle.page.keyboard.type(input.text);
      } else {
        await handle.page.keyboard.press(input.key);
      }

      session.lastAction = `user_${input.type}`;
      session.cursor = null;
      await captureSession(session, handle.page);
      return publicSession(session);
    });
  },

  async stopSession(sessionId: string) {
    return withSessionLock(sessionId, async () => {
      const session = sessions.get(sessionId);
      return session?.ownerId === AGENT_OWNER_ID ? stopLocked(session) : { stopped: false };
    });
  },

  async deleteSession(sessionId: string) {
    return withSessionLock(sessionId, async () => {
      const session = sessions.get(sessionId);
      if (session?.ownerId !== AGENT_OWNER_ID) return { deleted: false };
      await closeHandle(sessionId);
      sessions.delete(sessionId);
      return { deleted: true, sessionId };
    });
  },

  async agentStopSession(sessionId: string) {
    return withSessionLock(sessionId, async () => stopLocked(await this.getAgentSession(sessionId)));
  },

  async stopAllSessions() {
    await Promise.all([...sessions.keys()].map(async (sessionId) => {
      await closeHandle(sessionId);
      const session = sessions.get(sessionId);
      if (session) {
        delete session.control;
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
