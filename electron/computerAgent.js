import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const IPC_PREFIX = '@@CUAGENT@@';

function getDesktopPath() {
  const currentPath = process.env.PATH || '';
  const commonPaths = process.platform === 'win32'
    ? []
    : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  return [...commonPaths, currentPath].filter(Boolean).join(path.delimiter);
}

function getNodeRuntime(isPackaged) {
  if (isPackaged && process.versions.electron) {
    return { command: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  if (process.env.npm_node_execpath) {
    return { command: process.env.npm_node_execpath, env: {} };
  }
  return { command: 'node', env: {} };
}

function toAgentWsUrl(httpUrl) {
  try {
    const parsed = new URL(httpUrl);
    parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:';
    parsed.pathname = '/desktop-agent';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Keeps a Computer Use desktop agent connected to running cloud environments
 * while desktop access is enabled.
 */
export class ComputerAgentController {
  constructor({ appRoot, settingsPath, isPackaged = false, getRunningEnvironmentUrls, promptConsent, onChange }) {
    this.appRoot = appRoot;
    this.settingsPath = settingsPath;
    this.isPackaged = isPackaged;
    this.getRunningEnvironmentUrls = getRunningEnvironmentUrls;
    this.promptConsent = promptConsent;
    this.onChange = onChange;
    this.settings = { enabled: false, consentMode: 'ask' };
    this.child = null;
    this.connectedUrls = new Set();
    this.currentTargets = [];
    this.stdoutBuffer = '';
    this.lastEvent = null;
    this.lastError = null;
  }

  getSettings() {
    return { ...this.settings };
  }

  getState() {
    return {
      enabled: this.settings.enabled,
      consentMode: this.settings.consentMode,
      running: Boolean(this.child),
      connectedCount: this.connectedUrls.size,
      targetCount: this.currentTargets.length,
      targetUrls: [...this.currentTargets],
      lastEvent: this.lastEvent,
      lastError: this.lastError,
    };
  }

  async loadSettings() {
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf8');
      const stored = JSON.parse(raw);
      this.settings = {
        enabled: Boolean(stored.enabled),
        consentMode: stored.consentMode === 'auto' ? 'auto' : 'ask',
      };
    } catch {
      this.settings = { enabled: false, consentMode: 'ask' };
    }
    return this.settings;
  }

  async saveSettings(next) {
    this.settings = {
      enabled: Boolean(next.enabled),
      consentMode: next.consentMode === 'auto' ? 'auto' : 'ask',
    };
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
    await this.sync();
    this.onChange?.();
    return this.settings;
  }

  async sync() {
    const targets = this.settings.enabled ? (this.getRunningEnvironmentUrls?.() || []) : [];
    const wsTargets = targets.map(toAgentWsUrl).filter(Boolean);

    const sameTargets =
      wsTargets.length === this.currentTargets.length &&
      wsTargets.every((url) => this.currentTargets.includes(url));

    if (!this.settings.enabled || wsTargets.length === 0) {
      this.stop();
      this.currentTargets = [];
      this.lastEvent = this.settings.enabled ? 'no-targets' : 'disabled';
      return;
    }

    if (this.child && sameTargets) {
      return;
    }

    this.currentTargets = wsTargets;
    this.lastEvent = 'restarting';
    this.lastError = null;
    this.restart(wsTargets);
  }

  restart(wsTargets) {
    this.stop();

    const agentEntry = process.env.CLOUDCLI_COMPUTER_AGENT_ENTRY
      || path.join(this.appRoot, 'dist-server', 'server', 'computer-use-agent.js');
    const runtime = getNodeRuntime(this.isPackaged);

    this.child = spawn(runtime.command, [agentEntry], {
      cwd: this.appRoot,
      env: {
        ...process.env,
        ...runtime.env,
        PATH: getDesktopPath(),
        CLOUDCLI_DESKTOP_AGENT_URLS: wsTargets.join(','),
        CLOUDCLI_COMPUTER_USE_CONSENT_MODE: this.settings.consentMode,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.connectedUrls = new Set();

    this.child.once('error', (error) => {
      console.error('[ComputerAgent] failed to start:', error.message);
      this.lastEvent = 'start-error';
      this.lastError = error.message;
      this.child = null;
      this.onChange?.();
    });

    this.child.stdout?.on('data', (chunk) => this.handleStdout(String(chunk)));
    this.child.stderr?.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) {
          this.lastError = line.trim();
          console.error('[ComputerAgent]', line);
        }
      }
    });

    this.child.once('exit', (code) => {
      console.log(`[ComputerAgent] exited (code ${code ?? 'null'})`);
      this.lastEvent = `exit:${code ?? 'null'}`;
      this.child = null;
      this.connectedUrls = new Set();
      this.onChange?.();
    });

    this.onChange?.();
  }

  handleStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith(IPC_PREFIX)) {
        if (trimmed) console.log('[ComputerAgent]', trimmed);
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(trimmed.slice(IPC_PREFIX.length).trim());
      } catch {
        continue;
      }
      void this.handleAgentEvent(payload);
    }
  }

  async handleAgentEvent(payload) {
    switch (payload.type) {
      case 'connected':
        this.connectedUrls.add(payload.url);
        this.lastEvent = 'connected';
        this.lastError = null;
        this.onChange?.();
        break;
      case 'disconnected':
        this.connectedUrls.delete(payload.url);
        this.lastEvent = 'disconnected';
        this.onChange?.();
        break;
      case 'starting':
        this.lastEvent = 'starting';
        this.lastError = null;
        this.onChange?.();
        break;
      case 'error':
        this.lastEvent = 'error';
        this.lastError = payload.message || 'Computer agent error.';
        this.onChange?.();
        break;
      case 'consent-request': {
        const allow = await this.promptConsent?.(payload.sessionId);
        this.sendToChild({ type: 'consent-response', sessionId: payload.sessionId, allow: Boolean(allow) });
        break;
      }
      default:
        break;
    }
  }

  sendToChild(message) {
    if (this.child?.stdin?.writable) {
      this.child.stdin.write(`${IPC_PREFIX} ${JSON.stringify(message)}\n`);
    }
  }

  revokeSession(sessionId) {
    this.sendToChild({ type: 'revoke-session', sessionId });
  }

  stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.connectedUrls = new Set();
    try { child.kill('SIGTERM'); } catch { /* noop */ }
  }
}
