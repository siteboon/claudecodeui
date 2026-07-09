import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { WebSocket } from 'ws';

import { providerMcpService } from '@/modules/providers/index.js';
import { getModuleDir } from '@/utils/runtime-paths.js';

import {
  getOrCreateMcpToken,
  getProfilePath,
  normalizeBrowserBackend,
  PROFILE_ROOT,
  readSettings,
  resolveSessionProfileName,
  useVisibleCamoufoxBackend,
  writeSettings,
} from './browser-use.settings.js';
import type {
  BrowserUseSession,
  BrowserUseSettings,
  PublicBrowserUseSession,
  RuntimeHandle,
  RuntimeProbe,
  RuntimeReadiness,
} from './browser-use.types.js';
import { getViewerUrl, handleViewerWebSocket, VIEWER_TOKEN_TTL_MS } from './browser-use.viewer.js';

const require = createRequire(import.meta.url);
const __dirname = getModuleDir(import.meta.url);
const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';
const MAX_SESSIONS_PER_OWNER = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_MAX_SESSIONS_PER_OWNER || '3', 10);
const SESSION_TTL_MS = Number.parseInt(process.env.CLOUDCLI_BROWSER_USE_SESSION_TTL_MS || String(30 * 60 * 1000), 10);

const sessions = new Map<string, BrowserUseSession>();
const handles = new Map<string, RuntimeHandle>();
const viewerTokens = new Map<string, { token: string; expiresAt: number }>();
let installPromise: Promise<{ success: boolean; message: string }> | null = null;
let lastInstallMessage: string | null = null;
let runtimeProbeCache: { value: RuntimeProbe; updatedAt: number } | null = null;

const AGENT_OWNER_ID = 'agent';
const MCP_SERVER_NAME = 'cloudcli-browser';
const LEGACY_MCP_SERVER_NAMES = ['cloudcli-browser-use'];
const RUNTIME_READINESS_CACHE_TTL_MS = 30_000;
const VISIBLE_BROWSER_ENABLED = process.env.CLOUDCLI_BROWSER_USE_VISIBLE !== 'false';
// The noVNC viewer pipeline (Xvfb + x11vnc + websockify) only exists on Linux.
// On other platforms visible Camoufox sessions open a normal window on the host desktop.
const VNC_VIEWER_SUPPORTED = process.platform === 'linux';
const RUNTIME_ROOT = process.env.CLOUDCLI_BROWSER_USE_RUNTIME_ROOT || '/opt/claudecodeui/.runtime-browser';
const NOVNC_ROOT = process.env.CLOUDCLI_BROWSER_USE_NOVNC_ROOT || path.join(RUNTIME_ROOT, 'novnc');
const X11VNC_BIN = process.env.CLOUDCLI_BROWSER_USE_X11VNC_BIN || path.join(RUNTIME_ROOT, 'rootfs/usr/bin/x11vnc');
const X11VNC_LIB_DIR = process.env.CLOUDCLI_BROWSER_USE_X11VNC_LIB_DIR || path.join(RUNTIME_ROOT, 'rootfs/usr/lib/x86_64-linux-gnu');
const X11VNC_EXTRA_LIB_DIR = process.env.CLOUDCLI_BROWSER_USE_X11VNC_EXTRA_LIB_DIR || path.join(RUNTIME_ROOT, 'rootfs/lib/x86_64-linux-gnu');
const LOG_RUNTIME_PROCESS_OUTPUT = process.env.CLOUDCLI_BROWSER_USE_RUNTIME_LOGS === 'true';
const RUNTIME_PROCESS_SHUTDOWN_TIMEOUT_MS = 1_500;

function getRuntime(): 'cloud' | 'local' {
  return IS_PLATFORM ? 'cloud' : 'local';
}

const CAMOUFOX_CLI_CANDIDATES = [
  path.join(os.homedir(), '.local/bin/camoufox'),
  // PATH lookup covers pipx on Linux/macOS and the pip Scripts dir on Windows.
  'camoufox',
];
const CAMOUFOX_BINARY_CANDIDATES = process.platform === 'win32'
  ? ['camoufox.exe', 'camoufox']
  : process.platform === 'darwin'
    ? ['Camoufox.app/Contents/MacOS/camoufox', 'camoufox']
    : ['camoufox'];

function findCamoufoxBinary(installPath: string): string | null {
  if (!fs.statSync(installPath).isDirectory()) {
    return fs.existsSync(installPath) ? installPath : null;
  }
  for (const candidate of CAMOUFOX_BINARY_CANDIDATES) {
    const executablePath = path.join(installPath, candidate);
    if (fs.existsSync(executablePath)) {
      return executablePath;
    }
  }
  return null;
}

function getCamoufoxExecutablePath(): string | null {
  const configured = process.env.CLOUDCLI_BROWSER_USE_CAMOUFOX_EXECUTABLE;
  if (configured && fs.existsSync(configured)) {
    return findCamoufoxBinary(configured);
  }

  for (const cli of CAMOUFOX_CLI_CANDIDATES) {
    try {
      const output = execFileSync(cli, ['path'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const executablePath = findCamoufoxBinary(output);
      if (executablePath) {
        return executablePath;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function getSetupMessage(settings: BrowserUseSettings, readiness: RuntimeReadiness): string {
  if (!settings.enabled) {
    return 'Browser is disabled in settings.';
  }

  if (!readiness.playwrightInstalled) {
    return 'Install Playwright and Chromium to use browser sessions.';
  }

  if (settings.browserBackend === 'camoufox-vnc' && !getCamoufoxExecutablePath()) {
    return 'Camoufox is selected, but Camoufox is not installed.';
  }

  if (useVisibleCamoufoxBackend(settings)) {
    if (!VISIBLE_BROWSER_ENABLED) {
      return 'Camoufox is selected, but visible browser sessions are disabled.';
    }
    if (!getCamoufoxExecutablePath()) {
      return 'Camoufox is selected, but Camoufox is not installed.';
    }
    if (VNC_VIEWER_SUPPORTED) {
      if (!fs.existsSync(X11VNC_BIN)) {
        return 'Camoufox is selected, but x11vnc is missing.';
      }
      if (!fs.existsSync(path.join(NOVNC_ROOT, 'vnc.html'))) {
        return 'Camoufox is selected, but noVNC is missing.';
      }
    }
    return readiness.installMessage || 'Camoufox runtime is not ready.';
  }

  if (!readiness.chromiumInstalled) {
    return 'Playwright is installed, but Chromium is missing. Install the Chromium runtime to continue.';
  }

  return readiness.installMessage || 'Browser runtime is not ready.';
}

function isVncRuntimeInstalled(): boolean {
  return fs.existsSync(X11VNC_BIN) && fs.existsSync(path.join(NOVNC_ROOT, 'vnc.html'));
}

function isVisibleCamoufoxReady(): boolean {
  return VISIBLE_BROWSER_ENABLED
    && Boolean(getCamoufoxExecutablePath())
    && (!VNC_VIEWER_SUPPORTED || isVncRuntimeInstalled());
}

function getPlaywright(): any | null {
  try {
    return require('playwright');
  } catch {
    return null;
  }
}

function getMcpCommand(): { command: string; args: string[] } {
  const serverDir = path.resolve(__dirname, '..', '..');
  const mcpScriptPath = path.join(serverDir, 'browser-use-mcp.js');
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

function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolve(address.port);
        } else {
          reject(new Error('Failed to reserve a browser runtime port.'));
        }
      });
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRuntimeProcessAlive(child: ReturnType<typeof spawn>): boolean {
  return child.exitCode === null && child.signalCode === null && !child.killed;
}

function isRuntimeProcessRunning(child: ReturnType<typeof spawn>): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function assertRuntimeProcessesAlive(processes: Array<ReturnType<typeof spawn>>, label: string) {
  const exited = processes.find((child) => !isRuntimeProcessAlive(child));
  if (exited) {
    throw new Error(`${label} exited before the Browser viewer runtime was ready.`);
  }
}

async function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (listening: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(250);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForRuntimePort(
  port: number,
  label: string,
  processes: Array<ReturnType<typeof spawn>>,
  timeoutMs = 5_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertRuntimeProcessesAlive(processes, label);
    if (await isPortListening(port)) {
      return;
    }
    await delay(100);
  }
  assertRuntimeProcessesAlive(processes, label);
  throw new Error(`${label} did not start listening on 127.0.0.1:${port}.`);
}

function waitForRuntimeProcessExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<boolean> {
  if (!isRuntimeProcessRunning(child)) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off('exit', onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();
    child.once('exit', onExit);
  });
}

async function stopRuntimeProcesses(processes?: Array<ReturnType<typeof spawn>>) {
  const liveProcesses = processes?.filter(isRuntimeProcessRunning) || [];
  if (liveProcesses.length === 0) {
    return;
  }

  liveProcesses.forEach((child) => {
    try {
      child.kill('SIGTERM');
    } catch {
      // Process may have exited between filtering and signalling.
    }
  });

  const exited = await Promise.all(
    liveProcesses.map((child) => waitForRuntimeProcessExit(child, RUNTIME_PROCESS_SHUTDOWN_TIMEOUT_MS)),
  );
  const stubbornProcesses = liveProcesses.filter((child, index) => !exited[index] && isRuntimeProcessRunning(child));
  if (stubbornProcesses.length === 0) {
    return;
  }

  console.warn(`[Browser runtime] Force stopping ${stubbornProcesses.length} runtime process(es).`);
  stubbornProcesses.forEach((child) => {
    try {
      child.kill('SIGKILL');
    } catch {
      // Process may have exited before escalation.
    }
  });
  await Promise.all(stubbornProcesses.map((child) => waitForRuntimeProcessExit(child, 500)));
}

function spawnRuntimeProcess(command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr?.on('data', (chunk) => {
    if (!LOG_RUNTIME_PROCESS_OUTPUT) {
      return;
    }
    const text = String(chunk).trim();
    if (text) {
      console.warn(`[Browser runtime] ${path.basename(command)}: ${text}`);
    }
  });
  child.on('error', (error) => {
    console.warn(`[Browser runtime] ${path.basename(command)} failed:`, error.message);
  });
  return child;
}

function startXvfbProcess(): Promise<{ child: ReturnType<typeof spawn>; display: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('Xvfb', [
      '-displayfd',
      '3',
      '-screen',
      '0',
      '1440x900x24',
      '-ac',
      '-nolisten',
      'tcp',
    ], {
      env: process.env,
      stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    let displayOutput = '';
    const displayPipe = child.stdio[3];
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      void stopRuntimeProcesses([child]);
      finish(() => reject(new Error('Xvfb did not report an available display.')));
    }, 5_000);
    timer.unref?.();

    child.stderr?.on('data', (chunk) => {
      if (!LOG_RUNTIME_PROCESS_OUTPUT) {
        return;
      }
      const text = String(chunk).trim();
      if (text) {
        console.warn(`[Browser runtime] Xvfb: ${text}`);
      }
    });
    child.on('error', (error) => {
      console.warn('[Browser runtime] Xvfb failed:', error.message);
      finish(() => reject(error));
    });
    child.on('exit', (code, signal) => {
      finish(() => reject(new Error(`Xvfb exited before reporting a display (${signal || code}).`)));
    });
    displayPipe?.on('data', (chunk) => {
      displayOutput += String(chunk);
      const match = displayOutput.match(/\d+/);
      if (!match) {
        return;
      }
      finish(() => resolve({ child, display: `:${match[0]}` }));
    });
  });
}

async function startVisibleRuntime(): Promise<NonNullable<RuntimeHandle['viewer']> & { processes: Array<ReturnType<typeof spawn>> }> {
  const processes: Array<ReturnType<typeof spawn>> = [];

  try {
    const xvfb = await startXvfbProcess();
    const display = xvfb.display;
    processes.push(xvfb.child);
    const vncPort = await findAvailablePort();
    const websockifyPort = await findAvailablePort();

    assertRuntimeProcessesAlive(processes, 'Xvfb');

    if (!fs.existsSync(X11VNC_BIN)) {
      throw new Error(`x11vnc is missing at ${X11VNC_BIN}.`);
    }
    processes.push(spawnRuntimeProcess(X11VNC_BIN, [
      '-display',
      display,
      '-localhost',
      '-forever',
      '-shared',
      '-rfbport',
      String(vncPort),
      '-nopw',
      '-quiet',
    ], {
      env: {
        LD_LIBRARY_PATH: `${X11VNC_LIB_DIR}:${X11VNC_EXTRA_LIB_DIR}:${process.env.LD_LIBRARY_PATH || ''}`,
      },
    }));
    await waitForRuntimePort(vncPort, 'x11vnc', processes);

    if (!fs.existsSync(path.join(NOVNC_ROOT, 'vnc.html'))) {
      throw new Error(`noVNC is missing at ${NOVNC_ROOT}.`);
    }
    processes.push(spawnRuntimeProcess(path.join(os.homedir(), '.local/bin/websockify'), [
      '--web',
      NOVNC_ROOT,
      `127.0.0.1:${websockifyPort}`,
      `127.0.0.1:${vncPort}`,
    ]));
    await waitForRuntimePort(websockifyPort, 'websockify', processes);

    return {
      display,
      vncPort,
      websockifyPort,
      noVncRoot: NOVNC_ROOT,
      processes,
    };
  } catch (error) {
    await stopRuntimeProcesses(processes);
    throw error;
  }
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

    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));
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

function publicSession(session: BrowserUseSession): PublicBrowserUseSession {
  const { ownerId: _ownerId, ...publicFields } = session;
  return publicFields;
}

function getSessionViewer(sessionId: string): RuntimeHandle['viewer'] | null {
  const session = sessions.get(sessionId);
  if (!session || session.ownerId !== AGENT_OWNER_ID || session.status !== 'ready') {
    return null;
  }
  return handles.get(sessionId)?.viewer || null;
}

function createViewerToken(sessionId: string): string {
  const token = randomUUID();
  viewerTokens.set(sessionId, {
    token,
    expiresAt: Date.now() + VIEWER_TOKEN_TTL_MS,
  });
  return token;
}

function deleteViewerToken(sessionId: string) {
  viewerTokens.delete(sessionId);
}

function validateViewerTokenForSession(sessionId: string, token: string | null | undefined): boolean {
  if (!token) {
    return false;
  }
  const session = sessions.get(sessionId);
  const viewer = session?.ownerId === AGENT_OWNER_ID && session.status === 'ready'
    ? handles.get(sessionId)?.viewer || null
    : null;
  const stored = viewerTokens.get(sessionId);
  if (!viewer || !stored || stored.token !== token || stored.expiresAt < Date.now()) {
    if (stored?.expiresAt && stored.expiresAt < Date.now()) {
      viewerTokens.delete(sessionId);
    }
    return false;
  }
  return true;
}

function ownerSessions(ownerId: string): BrowserUseSession[] {
  return [...sessions.values()].filter((session) => session.ownerId === ownerId);
}

async function closeHandle(sessionId: string): Promise<void> {
  const handle = handles.get(sessionId);
  handles.delete(sessionId);
  deleteViewerToken(sessionId);
  await handle?.context?.close?.().catch(() => undefined);
  await handle?.browser?.close().catch(() => undefined);
  await stopRuntimeProcesses(handle?.processes);
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
      persistSessions: typeof settings.persistSessions === 'boolean' ? settings.persistSessions : current.persistSessions,
      defaultProfileName: typeof settings.defaultProfileName === 'string'
        ? settings.defaultProfileName
        : current.defaultProfileName,
      browserBackend: settings.browserBackend ? normalizeBrowserBackend(settings.browserBackend) : current.browserBackend,
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
    const useVisibleBackend = useVisibleCamoufoxBackend(settings);
    const visibleCamoufoxReady = useVisibleBackend
      && readiness.playwrightInstalled
      && isVisibleCamoufoxReady();
    const available = settings.enabled
      && readiness.playwrightInstalled
      && (useVisibleBackend ? visibleCamoufoxReady : readiness.chromiumInstalled);

    return {
      enabled: settings.enabled,
      runtime: getRuntime(),
      backend: useVisibleBackend ? 'camoufox-vnc' : 'playwright',
      browserBackend: settings.browserBackend,
      viewerMode: VNC_VIEWER_SUPPORTED ? 'novnc' : 'window',
      available,
      playwrightInstalled: readiness.playwrightInstalled,
      chromiumInstalled: readiness.chromiumInstalled,
      camoufoxInstalled: Boolean(getCamoufoxExecutablePath()),
      noVncInstalled: fs.existsSync(path.join(NOVNC_ROOT, 'vnc.html')),
      x11vncInstalled: fs.existsSync(X11VNC_BIN),
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
    const profileName = resolveSessionProfileName(settings, options?.profileName);

    const now = new Date().toISOString();
    const session: BrowserUseSession = {
      id: randomUUID(),
      ownerId: AGENT_OWNER_ID,
      createdBy: 'agent',
      runtime: getRuntime(),
      status: 'unavailable',
      url: null,
      title: null,
      screenshotDataUrl: null,
      createdAt: now,
      updatedAt: now,
      lastAction: 'create',
      message: null,
      backend: useVisibleCamoufoxBackend(settings) ? 'camoufox-vnc' : 'playwright',
      viewerUrl: null,
      viewerEmbedUrl: null,
      profileName,
      viewport: { width: 1440, height: 900 },
      cursor: null,
    };

    const activeOwnerSessions = ownerSessions(AGENT_OWNER_ID).filter((item) => item.status === 'ready');
    if (activeOwnerSessions.length >= MAX_SESSIONS_PER_OWNER) {
      throw new Error(`Browser is limited to ${MAX_SESSIONS_PER_OWNER} active agent sessions.`);
    }

    const readiness = getRuntimeReadiness();
    const useVisibleBackend = useVisibleCamoufoxBackend(settings);
    const visibleCamoufoxReady = useVisibleBackend && isVisibleCamoufoxReady();
    if (!settings.enabled || !readiness.playwrightInstalled || !readiness.playwright || (useVisibleBackend ? !visibleCamoufoxReady : !readiness.chromiumInstalled)) {
      session.message = getSetupMessage(settings, readiness);
      sessions.set(session.id, session);
      return publicSession(session);
    }

    let browser: any | undefined;
    let context: any | undefined;
    let page: any;
    let viewer: RuntimeHandle['viewer'];
    let processes: RuntimeHandle['processes'] = [];
    const launchOptions: Record<string, unknown> = {
      headless: !useVisibleBackend,
      args: ['--disable-dev-shm-usage'],
    };
    const contextOptions = useVisibleBackend
      ? { viewport: null }
      : {
        viewport: { width: 1440, height: 900 },
        serviceWorkers: 'block',
      };

    try {
      if (useVisibleBackend) {
        const camoufoxExecutable = getCamoufoxExecutablePath();
        if (!camoufoxExecutable) {
          throw new Error('Camoufox is not installed.');
        }
        launchOptions.executablePath = camoufoxExecutable;
        launchOptions.args = [];
        session.backend = 'camoufox-vnc';

        if (VNC_VIEWER_SUPPORTED) {
          const runtime = await startVisibleRuntime();
          viewer = {
            display: runtime.display,
            vncPort: runtime.vncPort,
            websockifyPort: runtime.websockifyPort,
            noVncRoot: runtime.noVncRoot,
          };
          processes = runtime.processes;
          launchOptions.env = {
            ...process.env,
            DISPLAY: runtime.display,
            LD_LIBRARY_PATH: `${X11VNC_LIB_DIR}:${X11VNC_EXTRA_LIB_DIR}:${process.env.LD_LIBRARY_PATH || ''}`,
          };
          const viewerToken = createViewerToken(session.id);
          session.viewerUrl = getViewerUrl(session.id, viewerToken);
          session.viewerEmbedUrl = session.viewerUrl;
        } else {
          // Without a VNC pipeline the browser opens as a normal window on the host desktop.
          session.message = 'Browser window is open on the machine running CloudCLI.';
        }
      }

      if (profileName) {
        fs.mkdirSync(PROFILE_ROOT, { recursive: true });
        const browserType = useVisibleBackend ? readiness.playwright.firefox : readiness.playwright.chromium;
        context = await browserType.launchPersistentContext(getProfilePath(profileName), {
          ...launchOptions,
          ...contextOptions,
        });
        page = context.pages()[0] || await context.newPage();
      } else {
        const browserType = useVisibleBackend ? readiness.playwright.firefox : readiness.playwright.chromium;
        browser = await browserType.launch(launchOptions);
        context = await browser.newContext(contextOptions);
        page = await context.newPage();
      }
    } catch (error) {
      await context?.close?.().catch(() => undefined);
      await browser?.close?.().catch(() => undefined);
      await stopRuntimeProcesses(processes);
      throw error;
    }
    session.status = 'ready';
    session.message = session.message || 'Browser session is ready.';
    sessions.set(session.id, session);
    handles.set(session.id, { browser, context, page, processes, viewer });
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
    return session;
  },

  async agentNavigate(sessionId: string, rawUrl: string) {
    await this.getAgentSession(sessionId);
    await expireStaleSessions();

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

    const url = normalizeUrl(rawUrl);
    await handle.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    session.lastAction = `navigate:${url}`;
    session.cursor = null;
    await captureSession(session, handle.page);
    return publicSession(session);
  },

  async agentSnapshot(sessionId: string) {
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
  },

  async agentClick(sessionId: string, input: { selector?: string; text?: string; x?: number; y?: number }) {
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
  },

  async agentType(sessionId: string, input: { selector?: string; text: string; submit?: boolean }) {
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
  },

  async agentFillForm(sessionId: string, fields: Array<{ selector: string; value: string }>) {
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
  },

  async agentPressKey(sessionId: string, key: string) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    await handle.page.keyboard.press(key);
    session.lastAction = `press_key:${key}`;
    await captureSession(session, handle.page);
    return publicSession(session);
  },

  async agentSelectOption(sessionId: string, selector: string, values: string[]) {
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
  },

  async agentWaitFor(sessionId: string, input: { text?: string; url?: string; timeoutMs?: number }) {
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
  },

  async agentTabs(sessionId: string, input: { action?: 'list' | 'new' | 'select' | 'close'; index?: number; url?: string }) {
    const session = await this.getAgentSession(sessionId);
    const handle = handles.get(sessionId);
    if (!handle?.context || !handle?.page) {
      throw new Error('Browser runtime handle is not available.');
    }
    const action = input.action || 'list';
    if (action === 'new') {
      const page = await handle.context.newPage();
      handles.set(sessionId, { ...handle, page });
      if (input.url) {
        await this.agentNavigate(sessionId, input.url);
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
  },

  async stopSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== AGENT_OWNER_ID) {
      return { stopped: false };
    }

    await closeHandle(sessionId);

    session.status = 'stopped';
    session.updatedAt = new Date().toISOString();
    session.lastAction = 'stop';
    session.message = 'Browser session stopped. Create a new session to continue browsing.';
    return { stopped: true, session: publicSession(session) };
  },

  async deleteSession(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session || session.ownerId !== AGENT_OWNER_ID) {
      return { deleted: false };
    }

    await closeHandle(sessionId);
    sessions.delete(sessionId);
    return { deleted: true, sessionId };
  },

  getViewerProxyTarget(sessionId: string) {
    const viewer = getSessionViewer(sessionId);
    if (!viewer) {
      throw new Error('Browser viewer is not available for this session.');
    }
    return {
      websockifyPort: viewer.websockifyPort,
      noVncRoot: viewer.noVncRoot,
    };
  },

  validateViewerToken(sessionId: string, token: string | null | undefined) {
    return validateViewerTokenForSession(sessionId, token);
  },

  handleViewerWebSocket(clientWs: WebSocket, pathname: string) {
    handleViewerWebSocket(clientWs, pathname, getSessionViewer);
  },

  async agentStopSession(sessionId: string) {
    await this.getAgentSession(sessionId);
    return this.stopSession(sessionId);
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
