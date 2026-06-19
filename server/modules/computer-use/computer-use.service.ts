import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { appConfigDb } from '@/modules/database/index.js';
import { providerMcpService } from '@/modules/providers/index.js';
import { getModuleDir } from '@/utils/runtime-paths.js';
import {
  getRuntimeReadiness as getExecutorReadiness,
  type Point,
  type ClickButton,
  type ScrollDirection,
} from '@/modules/computer-use/computer-executor.js';
import { runRawComputerAction } from '@/modules/computer-use/actions/raw-action-dispatcher.js';
import type { RawComputerAction } from '@/modules/computer-use/actions/raw-action-types.js';
import { desktopAgentRelay } from '@/modules/computer-use/desktop-agent-relay.service.js';
import { computerSemanticsService } from '@/modules/computer-use/computer-semantics.service.js';
import { semanticOperationNames } from '@/modules/computer-use/semantics/semantic-tool-dispatcher.js';

const __dirname = getModuleDir(import.meta.url);
const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';
const MAX_SESSIONS_PER_OWNER = Number.parseInt(process.env.CLOUDCLI_COMPUTER_USE_MAX_SESSIONS_PER_OWNER || '1', 10);
const SESSION_TTL_MS = Number.parseInt(process.env.CLOUDCLI_COMPUTER_USE_SESSION_TTL_MS || String(30 * 60 * 1000), 10);
const STOPPED_SESSION_RETENTION_MS = Number.parseInt(process.env.CLOUDCLI_COMPUTER_USE_STOPPED_SESSION_RETENTION_MS || String(30 * 60 * 1000), 10);
const MAX_STORED_SESSIONS = Number.parseInt(process.env.CLOUDCLI_COMPUTER_USE_MAX_STORED_SESSIONS || '100', 10);
const COMPUTER_USE_SETTINGS_KEY = 'computer_use_settings';
const COMPUTER_USE_MCP_TOKEN_KEY = 'computer_use_mcp_token';
type ComputerUseRuntime = 'cloud' | 'local';
type ComputerUseSessionStatus = 'ready' | 'stopped' | 'unavailable';

type ComputerUseSession = {
  id: string;
  ownerId: string;
  createdBy: 'user' | 'agent';
  runtime: ComputerUseRuntime;
  status: ComputerUseSessionStatus;
  screenshotDataUrl: string | null;
  createdAt: string;
  updatedAt: string;
  lastAction: string | null;
  message: string | null;
  /** Per-session consent: agents may act only while this is true. */
  agentAccessEnabled: boolean;
  /** Size of the captured screenshot in pixels — the coordinate space agents/users use. */
  displaySize: {
    width: number;
    height: number;
  } | null;
  cursor: {
    x: number;
    y: number;
    actor: 'agent' | 'user';
  } | null;
};

type PublicComputerUseSession = Omit<ComputerUseSession, 'ownerId'>;

type ComputerUseOwner = {
  id: string | number;
};

type ComputerUseSettings = {
  enabled: boolean;
};

type RuntimeReadiness = {
  nut: any | null;
  screenshot: any | null;
  nutInstalled: boolean;
  screenshotInstalled: boolean;
  installInProgress: boolean;
  installMessage: string | null;
};

const sessions = new Map<string, ComputerUseSession>();
let installPromise: Promise<{ success: boolean; message: string }> | null = null;
let lastInstallMessage: string | null = null;

const DEFAULT_SETTINGS: ComputerUseSettings = {
  enabled: false,
};
const AGENT_OWNER_ID = 'agent';
const MCP_SERVER_NAME = 'cloudcli-computer-use';
const MCP_PROVIDERS = ['claude', 'codex', 'cursor', 'gemini', 'opencode'];

function getRuntime(): ComputerUseRuntime {
  return IS_PLATFORM ? 'cloud' : 'local';
}

function readSettings(): ComputerUseSettings {
  try {
    const raw = appConfigDb.get(COMPUTER_USE_SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<ComputerUseSettings>;
    return {
      enabled: parsed.enabled === true,
    };
  } catch (error: any) {
    console.warn('[Computer Use] Failed to read settings:', error?.message || error);
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: ComputerUseSettings): ComputerUseSettings {
  const normalized = {
    enabled: settings.enabled === true,
  };

  appConfigDb.set(COMPUTER_USE_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

function getOrCreateMcpToken(): string {
  const existing = appConfigDb.get(COMPUTER_USE_MCP_TOKEN_KEY);
  if (existing) {
    return existing;
  }
  const token = randomBytes(32).toString('hex');
  appConfigDb.set(COMPUTER_USE_MCP_TOKEN_KEY, token);
  return token;
}

function getSetupMessage(settings: ComputerUseSettings, readiness: RuntimeReadiness): string {
  if (!settings.enabled) {
    return 'Computer Use is disabled in settings.';
  }
  if (getRuntime() === 'cloud') {
    return 'Open CloudCLI Desktop on this computer, connect the same account, and enable Computer Use.';
  }
  if (!readiness.nutInstalled || !readiness.screenshotInstalled) {
    return 'Install the desktop control runtime to capture the screen and drive the mouse and keyboard.';
  }
  return readiness.installMessage || 'Computer Use runtime is not ready.';
}

function getMcpCommand(): { command: string; args: string[] } {
  const serverDir = path.resolve(__dirname, '..', '..');
  const mcpScriptPath = path.join(serverDir, 'computer-use-mcp.js');
  if (fs.existsSync(mcpScriptPath)) {
    return {
      command: process.execPath,
      args: [mcpScriptPath],
    };
  }

  return {
    command: 'cloudcli',
    args: ['computer-use-mcp'],
  };
}

function getMcpApiUrl(): string {
  const port = process.env.SERVER_PORT || process.env.PORT || '3001';
  return `http://127.0.0.1:${port}/api/computer-use-mcp`;
}

function getRuntimeReadiness(): RuntimeReadiness {
  const base = getExecutorReadiness();
  return {
    ...base,
    installInProgress: Boolean(installPromise),
    installMessage: lastInstallMessage,
  };
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];

    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(output.join('').trim() || `${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function formatInstallError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (process.platform === 'linux' && /libxtst|x11|xtst|libpng|imagemagick|scrot/i.test(message)) {
    return [
      'Installing the desktop control runtime needs system packages.',
      'On Debian/Ubuntu run: sudo apt-get install -y libxtst-dev libpng-dev imagemagick',
      'then try again.',
    ].join(' ');
  }
  return message || 'Failed to install the Computer Use runtime.';
}

function isPackagedElectronNodeRuntime(): boolean {
  return process.env.ELECTRON_RUN_AS_NODE === '1' && Boolean(process.versions.electron);
}

async function installRuntime(): Promise<{ success: boolean; message: string }> {
  if (installPromise) {
    return installPromise;
  }

  const readiness = getExecutorReadiness();
  if (readiness.nutInstalled && readiness.screenshotInstalled) {
    lastInstallMessage = 'Computer Use runtime is available.';
    return { success: true, message: lastInstallMessage };
  }

  if (isPackagedElectronNodeRuntime()) {
    lastInstallMessage = 'Computer Use runtime was not bundled with this desktop build.';
    return { success: false, message: lastInstallMessage };
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  installPromise = (async () => {
    try {
      lastInstallMessage = 'Installing desktop control runtime…';
      await runCommand(npmCommand, [
        'install',
        '--no-save',
        '--no-package-lock',
        '@nut-tree-fork/nut-js',
        'screenshot-desktop',
      ]);

      lastInstallMessage = 'Computer Use runtime installed.';
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
  }
}

function getOwnerId(owner: ComputerUseOwner): string {
  if (owner.id === undefined || owner.id === null || String(owner.id).trim() === '') {
    throw new Error('Authenticated user is required.');
  }

  return String(owner.id);
}

function publicSession(session: ComputerUseSession): PublicComputerUseSession {
  const { ownerId: _ownerId, ...publicFields } = session;
  return publicFields;
}

function ownerSessions(ownerId: string): ComputerUseSession[] {
  return [...sessions.values()].filter((session) => session.ownerId === ownerId);
}

function canAccessSession(ownerId: string, session: ComputerUseSession): boolean {
  return session.ownerId === ownerId || session.ownerId === AGENT_OWNER_ID;
}

function normalizeSessionId(sessionId?: string | null): string | null {
  if (typeof sessionId !== 'string') {
    return null;
  }
  const trimmed = sessionId.trim();
  return trimmed ? trimmed : null;
}

function findActiveAgentSession(): ComputerUseSession | null {
  return ownerSessions(AGENT_OWNER_ID)
    .filter((session) => session.status === 'ready')
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0] || null;
}

function positiveDuration(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function expireStaleSessions(now = Date.now()): Promise<void> {
  const sessionTtl = positiveDuration(SESSION_TTL_MS, 30 * 60 * 1000);
  const stoppedRetention = positiveDuration(STOPPED_SESSION_RETENTION_MS, sessionTtl);

  for (const [sessionId, session] of sessions.entries()) {
    const updatedAt = Date.parse(session.updatedAt);
    if (!Number.isFinite(updatedAt)) {
      continue;
    }

    if (session.status === 'ready') {
      if (now - updatedAt <= sessionTtl) {
        continue;
      }
      session.status = 'stopped';
      session.agentAccessEnabled = false;
      session.updatedAt = new Date(now).toISOString();
      session.lastAction = 'expire';
      session.message = 'Computer Use session expired after inactivity.';
      continue;
    }

    if (now - updatedAt > stoppedRetention) {
      sessions.delete(sessionId);
    }
  }

  const maxStoredSessions = Number.isFinite(MAX_STORED_SESSIONS) && MAX_STORED_SESSIONS > 0
    ? MAX_STORED_SESSIONS
    : 100;
  if (sessions.size <= maxStoredSessions) {
    return;
  }

  const removable = [...sessions.values()]
    .filter((session) => session.status !== 'ready')
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  for (const session of removable) {
    if (sessions.size <= maxStoredSessions) {
      break;
    }
    sessions.delete(session.id);
  }
}

// --- Action layer: local executor (OSS) or cloud relay to the desktop agent --
//
// Every desktop interaction goes through `performAction` / `getCursorPosition`.
// In local mode it drives the in-process nut-js executor (computer-executor.ts);
// in cloud mode it forwards the action to the linked desktop agent over
// `desktopAgentRelay` and applies the returned screenshot. The local server
// itself never touches the OS in cloud mode.

/** Shape the desktop agent returns for any relayed action. */
type RelayResult = {
  screenshotDataUrl?: string | null;
  displaySize?: { width: number; height: number } | null;
  cursor?: { x: number; y: number } | null;
  position?: Point | null;
};

function applyRelayResult(session: ComputerUseSession, result: RelayResult): void {
  if (typeof result.screenshotDataUrl === 'string') {
    session.screenshotDataUrl = result.screenshotDataUrl;
  }
  if (result.displaySize) {
    session.displaySize = result.displaySize;
  }
  if (result.cursor) {
    session.cursor = { x: result.cursor.x, y: result.cursor.y, actor: session.cursor?.actor ?? 'agent' };
  }
  session.updatedAt = new Date().toISOString();
}

function stripSessionArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { sessionId: _sessionId, ...toolArgs } = args;
  return toolArgs;
}

async function refreshScreenshot(session: ComputerUseSession): Promise<void> {
  if (getRuntime() === 'cloud') {
    const result = (await desktopAgentRelay.relay('screenshot', { sessionId: session.id })) as RelayResult;
    applyRelayResult(session, result);
    return;
  }
  applyRelayResult(session, await runRawComputerAction({ type: 'screenshot' }, session));
}

/** Runs one action and refreshes the session screenshot afterwards. */
async function performAction(session: ComputerUseSession, action: RawComputerAction): Promise<void> {
  if (getRuntime() === 'cloud') {
    const result = (await desktopAgentRelay.relay(action.type, {
      ...action,
      sessionId: session.id,
      displaySize: session.displaySize,
    })) as RelayResult;
    applyRelayResult(session, result);
    return;
  }

  applyRelayResult(session, await runRawComputerAction(action, session));
}

/** Reads the current cursor position in screenshot-pixel space. */
async function getCursorPosition(session: ComputerUseSession): Promise<Point> {
  if (getRuntime() === 'cloud') {
    const result = (await desktopAgentRelay.relay('cursor_position', {
      sessionId: session.id,
      displaySize: session.displaySize,
    })) as RelayResult;
    applyRelayResult(session, result);
    if (result.position) {
      return result.position;
    }
    return session.cursor ? { x: session.cursor.x, y: session.cursor.y } : { x: 0, y: 0 };
  }
  const result = await runRawComputerAction({ type: 'cursor_position' }, session);
  applyRelayResult(session, result);
  return result.position || session.cursor || { x: 0, y: 0 };
}

function assertReady(session: ComputerUseSession): void {
  if (session.status !== 'ready') {
    throw new Error(session.message || 'Computer Use session is not available.');
  }
}

function agentToolsAvailable(): boolean {
  const settings = readSettings();
  if (!settings.enabled) {
    return false;
  }
  if (getRuntime() === 'cloud') {
    return desktopAgentRelay.isConnected();
  }
  return true;
}

function assertAgentToolsAvailable(): void {
  if (agentToolsAvailable()) {
    return;
  }
  const settings = readSettings();
  if (!settings.enabled) {
    throw new Error('Computer Use agent tools are disabled.');
  }
  throw new Error(
    getRuntime() === 'cloud'
      ? 'No desktop is linked. Open CloudCLI Desktop on this computer, connect the same account, and enable Computer Use.'
      : 'Computer Use agent tools are disabled.'
  );
}

function stopSessions(lastAction: string, message: string): void {
  for (const session of sessions.values()) {
    session.status = 'stopped';
    session.agentAccessEnabled = false;
    session.updatedAt = new Date().toISOString();
    session.lastAction = lastAction;
    session.message = message;
  }
}

export const computerUseService = {
  async getSettings() {
    return readSettings();
  },

  async updateSettings(settings: Partial<ComputerUseSettings>) {
    const current = readSettings();
    const enabled = typeof settings.enabled === 'boolean' ? settings.enabled : current.enabled;
    const next = writeSettings({ enabled });
    if (next.enabled) {
      await this.registerAgentMcp();
    } else {
      await this.unregisterAgentMcp();
      stopSessions('settings:disabled', 'Computer Use was disabled in settings.');
    }
    return next;
  },

  async getStatus() {
    const settings = readSettings();
    const readiness = getRuntimeReadiness();
    const isCloud = getRuntime() === 'cloud';
    const runtimeReady = readiness.nutInstalled && readiness.screenshotInstalled;
    // Cloud mode still respects the saved feature setting. When enabled, cloud
    // availability comes from a linked desktop agent because the hosted server
    // has no screen of its own.
    const desktopAgentConnected = desktopAgentRelay.isConnected();
    const available = settings.enabled && (isCloud
      ? desktopAgentConnected
      : runtimeReady);

    return {
      enabled: settings.enabled,
      runtime: getRuntime(),
      available,
      desktopAgentConnected,
      desktopAgentCount: desktopAgentRelay.connectedCount(),
      nutInstalled: readiness.nutInstalled,
      screenshotInstalled: readiness.screenshotInstalled,
      installInProgress: readiness.installInProgress,
      sessionCount: sessions.size,
      message: available ? 'Computer Use runtime is available.' : getSetupMessage(settings, readiness),
    };
  },

  async registerAgentMcp() {
    const { command, args } = getMcpCommand();
    const results = await providerMcpService.addMcpServerToAllProviders({
      name: MCP_SERVER_NAME,
      scope: 'user',
      transport: 'stdio',
      command,
      args,
      env: {
        CLOUDCLI_COMPUTER_USE_MCP_TOKEN: getOrCreateMcpToken(),
        CLOUDCLI_COMPUTER_USE_API_URL: getMcpApiUrl(),
      },
    });
    return { name: MCP_SERVER_NAME, command, args, results };
  },

  getMcpToken() {
    return getOrCreateMcpToken();
  },

  async unregisterAgentMcp() {
    const results = await Promise.all(MCP_PROVIDERS.map(async (provider) => {
      try {
        const result = await providerMcpService.removeProviderMcpServer(provider, {
          name: MCP_SERVER_NAME,
          scope: 'user',
        });
        return { provider, removed: result.removed };
      } catch (error) {
        return {
          provider,
          removed: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }));
    return { name: MCP_SERVER_NAME, results };
  },

  async installRuntime() {
    const result = await installRuntime();
    return {
      ...result,
      status: await this.getStatus(),
    };
  },

  async listSessions(owner: ComputerUseOwner) {
    const ownerId = getOwnerId(owner);
    await expireStaleSessions();
    return [...sessions.values()]
      .filter((session) => canAccessSession(ownerId, session))
      .map(publicSession);
  },

  async createSession(owner: ComputerUseOwner, options?: { createdBy?: 'user' | 'agent' }) {
    const ownerId = getOwnerId(owner);
    await expireStaleSessions();
    const createdBy = options?.createdBy ?? 'user';

    const now = new Date().toISOString();
    const session: ComputerUseSession = {
      id: randomUUID(),
      ownerId,
      createdBy,
      runtime: getRuntime(),
      status: 'unavailable',
      screenshotDataUrl: null,
      createdAt: now,
      updatedAt: now,
      lastAction: 'create',
      // Consent is always OFF at creation — the user must explicitly grant control,
      // even for agent-initiated sessions controlling the full desktop.
      agentAccessEnabled: false,
      displaySize: null,
      message: null,
      cursor: null,
    };

    const activeOwnerSessions = ownerSessions(ownerId).filter((item) => item.status === 'ready');
    if (activeOwnerSessions.length >= MAX_SESSIONS_PER_OWNER) {
      throw new Error(`Computer Use is limited to ${MAX_SESSIONS_PER_OWNER} active session(s).`);
    }

    const settings = readSettings();
    const readiness = getRuntimeReadiness();
    const isCloud = getRuntime() === 'cloud';
    const runtimeReady = readiness.nutInstalled && readiness.screenshotInstalled;
    const ready = settings.enabled && (isCloud
      ? desktopAgentRelay.isConnected()
      : runtimeReady);

    if (!ready) {
      session.message = getSetupMessage(settings, readiness);
      sessions.set(session.id, session);
      return publicSession(session);
    }

    // In cloud mode the linked desktop agent is the consent authority and prompts
    // the user per its own consent mode, so the relay is allowed to act. In local
    // mode the user must still grant control from the panel.
    if (isCloud) {
      session.agentAccessEnabled = true;
    }

    session.status = 'ready';
    session.message = isCloud
      ? 'Computer Use session is ready on the linked desktop.'
      : 'Computer Use session is ready. Grant control to let agents act.';
    sessions.set(session.id, session);
    try {
      await refreshScreenshot(session);
    } catch (error) {
      session.status = 'unavailable';
      session.message = error instanceof Error ? error.message : 'Failed to capture the screen.';
    }
    return publicSession(session);
  },

  async grantAgentAccess(owner: ComputerUseOwner, sessionId: string) {
    const ownerId = getOwnerId(owner);
    const session = sessions.get(sessionId);
    if (!session || !canAccessSession(ownerId, session)) {
      throw new Error('Computer Use session not found.');
    }
    session.agentAccessEnabled = true;
    session.updatedAt = new Date().toISOString();
    session.lastAction = 'consent:grant';
    return publicSession(session);
  },

  async revokeAgentAccess(owner: ComputerUseOwner, sessionId: string) {
    const ownerId = getOwnerId(owner);
    const session = sessions.get(sessionId);
    if (!session || !canAccessSession(ownerId, session)) {
      throw new Error('Computer Use session not found.');
    }
    session.agentAccessEnabled = false;
    session.updatedAt = new Date().toISOString();
    session.lastAction = 'consent:revoke';
    return publicSession(session);
  },

  async stopSession(owner: ComputerUseOwner, sessionId: string) {
    const ownerId = getOwnerId(owner);
    const session = sessions.get(sessionId);
    if (!session || !canAccessSession(ownerId, session)) {
      return { stopped: false };
    }

    session.status = 'stopped';
    session.agentAccessEnabled = false;
    session.updatedAt = new Date().toISOString();
    session.lastAction = 'stop';
    session.message = 'Computer Use session stopped. Agent control is revoked.';
    if (getRuntime() === 'cloud' && desktopAgentRelay.isConnected()) {
      // Best-effort: tell the desktop agent to forget this session's consent.
      void desktopAgentRelay.relay('stop_session', { sessionId }).catch(() => undefined);
    }
    return { stopped: true, session: publicSession(session) };
  },

  async deleteSession(owner: ComputerUseOwner, sessionId: string) {
    const ownerId = getOwnerId(owner);
    const session = sessions.get(sessionId);
    if (!session || !canAccessSession(ownerId, session)) {
      return { deleted: false };
    }

    sessions.delete(sessionId);
    return { deleted: true, sessionId };
  },

  // --- User-initiated actions (from the panel) -------------------------------

  async userScreenshot(owner: ComputerUseOwner, sessionId: string) {
    const ownerId = getOwnerId(owner);
    const session = sessions.get(sessionId);
    if (!session || !canAccessSession(ownerId, session)) {
      throw new Error('Computer Use session not found.');
    }
    assertReady(session);
    await refreshScreenshot(session);
    session.lastAction = 'screenshot';
    return publicSession(session);
  },

  async userClick(owner: ComputerUseOwner, sessionId: string, input: { x: number; y: number; button?: ClickButton; double?: boolean }) {
    const ownerId = getOwnerId(owner);
    const session = sessions.get(sessionId);
    if (!session || !canAccessSession(ownerId, session)) {
      throw new Error('Computer Use session not found.');
    }
    assertReady(session);
    await performAction(session, {
      type: 'click',
      button: input.button || 'left',
      point: { x: input.x, y: input.y },
      double: input.double === true,
    });
    session.cursor = { x: input.x, y: input.y, actor: 'user' };
    session.lastAction = input.double ? 'double_click' : 'click';
    return publicSession(session);
  },

  async userPressKey(owner: ComputerUseOwner, sessionId: string, key: string) {
    const ownerId = getOwnerId(owner);
    const session = sessions.get(sessionId);
    if (!session || !canAccessSession(ownerId, session)) {
      throw new Error('Computer Use session not found.');
    }
    assertReady(session);
    await performAction(session, { type: 'key', key });
    session.lastAction = `key:${key}`;
    return publicSession(session);
  },

  // --- Agent-initiated actions (via MCP) ------------------------------------

  /**
   * Resolves a session the agent is allowed to act on. In local mode this
   * enforces the in-process per-session consent flag. In cloud mode the linked
   * desktop agent is the consent authority (it prompts the user per its own
   * consent mode), so this only requires the relay to be connected.
   */
  async getOrCreateAgentSession(): Promise<ComputerUseSession> {
    assertAgentToolsAvailable();
    await expireStaleSessions();
    const existing = findActiveAgentSession();
    if (existing) {
      return existing;
    }

    const created = await this.createSession({ id: AGENT_OWNER_ID }, { createdBy: 'agent' });
    const session = sessions.get(created.id);
    if (!session) {
      throw new Error('Computer Use session could not be created.');
    }
    return session;
  },

  async getConsentedSession(sessionId?: string): Promise<ComputerUseSession> {
    assertAgentToolsAvailable();
    const normalizedSessionId = normalizeSessionId(sessionId);
    const session = normalizedSessionId
      ? sessions.get(normalizedSessionId)
      : await this.getOrCreateAgentSession();
    if (!session) {
      throw new Error('Computer Use session not found.');
    }
    if (getRuntime() !== 'cloud' && !session.agentAccessEnabled) {
      throw new Error(`Computer Use session ${session.id} is awaiting user consent. Ask the user to grant control in the Computer panel.`);
    }
    assertReady(session);
    return session;
  },

  async agentScreenshot(sessionId?: string) {
    const session = await this.getConsentedSession(sessionId);
    await refreshScreenshot(session);
    session.lastAction = 'screenshot';
    return publicSession(session);
  },

  async agentCursorPosition(sessionId?: string) {
    const session = await this.getConsentedSession(sessionId);
    const point = await getCursorPosition(session);
    session.cursor = { ...point, actor: 'agent' };
    session.lastAction = 'cursor_position';
    return { session: publicSession(session), position: point };
  },

  async agentMouseMove(sessionId: string | undefined, point: Point) {
    const session = await this.getConsentedSession(sessionId);
    await performAction(session, { type: 'mouse_move', point });
    session.cursor = { ...point, actor: 'agent' };
    session.lastAction = 'mouse_move';
    return publicSession(session);
  },

  async agentUnifiedClick(sessionId: string | undefined, input: { button?: ClickButton; point?: Point; clickCount?: number }) {
    const session = await this.getConsentedSession(sessionId);
    const button = input.button || 'left';
    const clickCount = Math.max(1, Math.min(Math.trunc(input.clickCount || 1), 5));
    for (let index = 0; index < clickCount; index += 1) {
      await performAction(session, { type: 'click', button, point: input.point, double: false });
    }
    if (input.point) {
      session.cursor = { ...input.point, actor: 'agent' };
    }
    session.lastAction = clickCount > 1 ? `${button}_click:${clickCount}` : `${button}_click`;
    return publicSession(session);
  },

  async agentDrag(sessionId: string | undefined, from: Point, to: Point, button: ClickButton = 'left') {
    const session = await this.getConsentedSession(sessionId);
    await performAction(session, { type: 'drag', from, to, button });
    session.cursor = { ...to, actor: 'agent' };
    session.lastAction = `${button}_drag`;
    return publicSession(session);
  },

  async agentType(sessionId: string | undefined, text: string) {
    const session = await this.getConsentedSession(sessionId);
    await performAction(session, { type: 'type', text });
    session.lastAction = 'type';
    return publicSession(session);
  },

  async agentKey(sessionId: string | undefined, key: string) {
    const session = await this.getConsentedSession(sessionId);
    await performAction(session, { type: 'key', key });
    session.lastAction = `key:${key}`;
    return publicSession(session);
  },

  async agentScroll(sessionId: string | undefined, input: { direction: ScrollDirection; amount?: number; x?: number; y?: number }) {
    const session = await this.getConsentedSession(sessionId);
    const point = typeof input.x === 'number' && typeof input.y === 'number' ? { x: input.x, y: input.y } : undefined;
    await performAction(session, { type: 'scroll', direction: input.direction, amount: input.amount, point });
    if (point) {
      session.cursor = { ...point, actor: 'agent' };
    }
    session.lastAction = `scroll:${input.direction}`;
    return publicSession(session);
  },

  async agentWait(sessionId?: string, timeoutMs?: number) {
    const session = await this.getConsentedSession(sessionId);
    await performAction(session, { type: 'wait', ms: timeoutMs });
    session.lastAction = 'wait';
    return publicSession(session);
  },

  async agentStopSession(sessionId?: string) {
    assertAgentToolsAvailable();
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (normalizedSessionId) {
      return this.stopSession({ id: AGENT_OWNER_ID }, normalizedSessionId);
    }

    await expireStaleSessions();
    const existing = findActiveAgentSession();
    if (!existing) {
      return { stopped: false };
    }
    return this.stopSession({ id: AGENT_OWNER_ID }, existing.id);
  },

  async callSemanticTool(toolName: string, args: Record<string, unknown>) {
    if (!semanticOperationNames.has(toolName)) {
      throw new Error(`Unsupported semantic Computer Use tool: ${toolName}`);
    }

    const sessionId = typeof args.sessionId === 'string' ? args.sessionId : undefined;
    const session = await this.getConsentedSession(normalizeSessionId(sessionId) ?? undefined);
    const toolArgs = { ...stripSessionArgs(args), sessionId: session.id };
    const semanticResult = getRuntime() === 'cloud'
      ? await desktopAgentRelay.relay('semantic_tool', {
        sessionId: session.id,
        displaySize: session.displaySize,
        toolName,
        arguments: toolArgs,
      })
      : await computerSemanticsService.callTool(toolName, toolArgs);

    applyRelayResult(session, semanticResult as RelayResult);
    session.lastAction = `semantic:${toolName}`;
    return { session: publicSession(session), result: semanticResult };
  },

  /**
   * Cloud only: when a desktop agent links to this hosted environment, expose
   * the computer_* MCP tools only if the user enabled Computer Use in settings.
   */
  async onDesktopAgentConnected() {
    if (getRuntime() !== 'cloud') {
      return;
    }
    if (!readSettings().enabled) {
      return;
    }
    try {
      await this.registerAgentMcp();
    } catch (error) {
      console.warn('[Computer Use] Failed to register MCP for linked desktop agent:', error instanceof Error ? error.message : error);
    }
  },

  /** Cloud only: tear down sessions when the last desktop agent disconnects. */
  async onDesktopAgentDisconnected() {
    if (getRuntime() !== 'cloud' || desktopAgentRelay.isConnected()) {
      return;
    }
    for (const session of sessions.values()) {
      if (session.status === 'ready') {
        session.status = 'stopped';
        session.agentAccessEnabled = false;
        session.updatedAt = new Date().toISOString();
        session.lastAction = 'agent-disconnected';
        session.message = 'The linked desktop agent disconnected.';
      }
    }
  },

  async stopAllSessions() {
    stopSessions('shutdown', 'Computer Use session stopped during server shutdown.');
  },
};

// Drive cloud MCP exposure + session teardown off desktop-agent connectivity.
desktopAgentRelay.setHooks({
  onFirstConnect: () => computerUseService.onDesktopAgentConnected(),
  onLastDisconnect: () => computerUseService.onDesktopAgentDisconnected(),
});

process.once('beforeExit', () => {
  void computerUseService.stopAllSessions();
});
