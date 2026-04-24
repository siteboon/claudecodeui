import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';

const DEFAULT_SERVER_PORT = 3001;
const DAEMON_DIR = path.join(os.homedir(), '.cloudcli', 'daemon');
const PID_FILE = path.join(DAEMON_DIR, 'daemon.pid');
const STATE_FILE = path.join(DAEMON_DIR, 'daemon-state.json');
const LOG_FILE = path.join(DAEMON_DIR, 'daemon.log');

const LINUX_SYSTEMD_UNIT = 'cloudcli-daemon.service';
const LINUX_SYSTEMD_UNIT_PATH = path.join(os.homedir(), '.config', 'systemd', 'user', LINUX_SYSTEMD_UNIT);
const MACOS_LAUNCH_AGENT_LABEL = 'ai.cloudcli.daemon';
const MACOS_LAUNCH_AGENT_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${MACOS_LAUNCH_AGENT_LABEL}.plist`);
const WINDOWS_TASK_NAME = 'cloudcli-daemon';

function ensureDaemonDir() {
  fs.mkdirSync(DAEMON_DIR, { recursive: true });
}

function parsePort(value, fallback = DEFAULT_SERVER_PORT) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readPidFile() {
  try {
    const raw = fs.readFileSync(PID_FILE, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePidFile(pid) {
  fs.writeFileSync(PID_FILE, `${pid}\n`);
}

function readStateFile() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeStateFile(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

function clearDaemonFiles() {
  safeUnlink(PID_FILE);
  safeUnlink(STATE_FILE);
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return !isProcessRunning(pid);
}

function quoteSystemdArg(arg) {
  return `"${String(arg).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function quoteWindowsArg(arg) {
  return `"${String(arg).replace(/"/g, '""')}"`;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildDaemonStartArgs({ serverPort, databasePath } = {}) {
  const args = ['daemon', 'start'];

  if (serverPort) {
    args.push('--port', String(serverPort));
  }

  if (databasePath) {
    args.push('--database-path', databasePath);
  }

  return args;
}

function terminateProcess(pid, force = false) {
  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), '/T'];
    if (force) {
      args.push('/F');
    }
    execFileSync('taskkill', args, { stdio: 'pipe' });
    return;
  }

  process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
}

async function checkHealth(port) {
  return new Promise((resolve) => {
    let settled = false;
    const complete = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    const req = http.get({
      host: '127.0.0.1',
      port,
      path: '/health',
      timeout: 1200
    }, (res) => {
      complete(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 500));
      res.resume();
    });

    req.on('error', () => complete(false));
    req.on('timeout', () => {
      req.destroy();
      complete(false);
    });
  });
}

function buildLinuxSystemdUnit({ nodePath, cliEntryPath, serverPort, databasePath }) {
  const startArgs = buildDaemonStartArgs({ serverPort, databasePath });
  const execStart = [quoteSystemdArg(nodePath), quoteSystemdArg(cliEntryPath), ...startArgs.map(quoteSystemdArg)].join(' ');
  const execStop = [quoteSystemdArg(nodePath), quoteSystemdArg(cliEntryPath), quoteSystemdArg('daemon'), quoteSystemdArg('stop')].join(' ');

  return `[Unit]
Description=CloudCLI daemon bootstrap
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${execStart}
ExecStop=${execStop}

[Install]
WantedBy=default.target
`;
}

function enableLinuxAutostart(options) {
  const systemdDir = path.dirname(LINUX_SYSTEMD_UNIT_PATH);
  fs.mkdirSync(systemdDir, { recursive: true });
  fs.writeFileSync(LINUX_SYSTEMD_UNIT_PATH, buildLinuxSystemdUnit(options), 'utf8');

  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
    execFileSync('systemctl', ['--user', 'enable', '--now', LINUX_SYSTEMD_UNIT], { stdio: 'pipe' });
  } catch (error) {
    throw new Error(`Failed to enable systemd user service. ${error.message}`);
  }

  return { mode: 'systemd', enabled: true, path: LINUX_SYSTEMD_UNIT_PATH };
}

function disableLinuxAutostart() {
  try {
    execFileSync('systemctl', ['--user', 'disable', '--now', LINUX_SYSTEMD_UNIT], { stdio: 'pipe' });
  } catch {
    // Best-effort disable; we still remove the unit file below.
  }

  safeUnlink(LINUX_SYSTEMD_UNIT_PATH);

  try {
    execFileSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'pipe' });
  } catch {
    // Non-systemd environments may fail this call.
  }

  return { mode: 'systemd', enabled: false, path: LINUX_SYSTEMD_UNIT_PATH };
}

function getLinuxAutostartStatus() {
  if (!fs.existsSync(LINUX_SYSTEMD_UNIT_PATH)) {
    return { enabled: false, mode: 'systemd', path: LINUX_SYSTEMD_UNIT_PATH };
  }

  try {
    const enabled = execFileSync('systemctl', ['--user', 'is-enabled', LINUX_SYSTEMD_UNIT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    return { enabled: enabled === 'enabled', mode: 'systemd', path: LINUX_SYSTEMD_UNIT_PATH };
  } catch {
    return { enabled: false, mode: 'systemd', path: LINUX_SYSTEMD_UNIT_PATH };
  }
}

function buildMacLaunchAgent({ nodePath, cliEntryPath, serverPort, databasePath }) {
  const args = [nodePath, cliEntryPath, ...buildDaemonStartArgs({ serverPort, databasePath })];
  const xmlArgs = args.map((arg) => `    <string>${xmlEscape(arg)}</string>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MACOS_LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${xmlArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(LOG_FILE)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(LOG_FILE)}</string>
</dict>
</plist>
`;
}

function enableMacAutostart(options) {
  fs.mkdirSync(path.dirname(MACOS_LAUNCH_AGENT_PATH), { recursive: true });
  fs.writeFileSync(MACOS_LAUNCH_AGENT_PATH, buildMacLaunchAgent(options), 'utf8');

  try {
    execFileSync('launchctl', ['unload', MACOS_LAUNCH_AGENT_PATH], { stdio: 'pipe' });
  } catch {
    // If not loaded yet, unload fails — safe to ignore.
  }

  execFileSync('launchctl', ['load', '-w', MACOS_LAUNCH_AGENT_PATH], { stdio: 'pipe' });

  return { mode: 'launchagent', enabled: true, path: MACOS_LAUNCH_AGENT_PATH };
}

function disableMacAutostart() {
  try {
    execFileSync('launchctl', ['unload', '-w', MACOS_LAUNCH_AGENT_PATH], { stdio: 'pipe' });
  } catch {
    // Best effort.
  }

  safeUnlink(MACOS_LAUNCH_AGENT_PATH);
  return { mode: 'launchagent', enabled: false, path: MACOS_LAUNCH_AGENT_PATH };
}

function getMacAutostartStatus() {
  return {
    enabled: fs.existsSync(MACOS_LAUNCH_AGENT_PATH),
    mode: 'launchagent',
    path: MACOS_LAUNCH_AGENT_PATH
  };
}

function enableWindowsAutostart({ nodePath, cliEntryPath, serverPort, databasePath }) {
  const command = [
    quoteWindowsArg(nodePath),
    quoteWindowsArg(cliEntryPath),
    ...buildDaemonStartArgs({ serverPort, databasePath }).map(quoteWindowsArg)
  ].join(' ');

  execFileSync('schtasks', [
    '/Create',
    '/F',
    '/SC',
    'ONLOGON',
    '/TN',
    WINDOWS_TASK_NAME,
    '/TR',
    command,
    '/RL',
    'LIMITED'
  ], { stdio: 'pipe' });

  try {
    execFileSync('schtasks', ['/Run', '/TN', WINDOWS_TASK_NAME], { stdio: 'pipe' });
  } catch {
    // Task creation succeeded; run may fail in some contexts.
  }

  return { mode: 'taskscheduler', enabled: true, path: WINDOWS_TASK_NAME };
}

function disableWindowsAutostart() {
  try {
    execFileSync('schtasks', ['/Delete', '/F', '/TN', WINDOWS_TASK_NAME], { stdio: 'pipe' });
  } catch {
    // Best effort; task may already be absent.
  }

  return { mode: 'taskscheduler', enabled: false, path: WINDOWS_TASK_NAME };
}

function getWindowsAutostartStatus() {
  try {
    execFileSync('schtasks', ['/Query', '/TN', WINDOWS_TASK_NAME], { stdio: 'pipe' });
    return { enabled: true, mode: 'taskscheduler', path: WINDOWS_TASK_NAME };
  } catch {
    return { enabled: false, mode: 'taskscheduler', path: WINDOWS_TASK_NAME };
  }
}

export function getDaemonPaths() {
  return {
    daemonDir: DAEMON_DIR,
    pidFile: PID_FILE,
    stateFile: STATE_FILE,
    logFile: LOG_FILE
  };
}

export function startDaemon({ nodePath, cliEntryPath, serverPort, databasePath } = {}) {
  if (!nodePath || !cliEntryPath) {
    throw new Error('nodePath and cliEntryPath are required to start daemon mode');
  }

  ensureDaemonDir();

  const existingPid = readPidFile();
  if (existingPid && isProcessRunning(existingPid)) {
    const state = readStateFile();
    return {
      started: false,
      alreadyRunning: true,
      pid: existingPid,
      port: parsePort(state.serverPort)
    };
  }

  if (existingPid) {
    clearDaemonFiles();
  }

  const resolvedPort = parsePort(serverPort, parsePort(process.env.SERVER_PORT || process.env.PORT));
  const resolvedDatabasePath = databasePath || process.env.DATABASE_PATH || null;
  const args = ['start', '--port', String(resolvedPort)];
  if (resolvedDatabasePath) {
    args.push('--database-path', resolvedDatabasePath);
  }

  const logFd = fs.openSync(LOG_FILE, 'a');
  try {
    const child = spawn(nodePath, [cliEntryPath, ...args], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      env: {
        ...process.env,
        CLOUDCLI_SKIP_UPDATE_CHECK: '1',
        SERVER_PORT: String(resolvedPort),
        ...(resolvedDatabasePath ? { DATABASE_PATH: resolvedDatabasePath } : {})
      }
    });

    child.unref();
    writePidFile(child.pid);
    writeStateFile({
      pid: child.pid,
      serverPort: resolvedPort,
      databasePath: resolvedDatabasePath,
      startedAt: new Date().toISOString()
    });

    return {
      started: true,
      alreadyRunning: false,
      pid: child.pid,
      port: resolvedPort
    };
  } finally {
    fs.closeSync(logFd);
  }
}

export async function stopDaemon() {
  ensureDaemonDir();
  const pid = readPidFile();

  if (!pid) {
    return { stopped: false, reason: 'not_running' };
  }

  if (!isProcessRunning(pid)) {
    clearDaemonFiles();
    return { stopped: true, reason: 'stale_pid', pid };
  }

  try {
    terminateProcess(pid, process.platform === 'win32');
  } catch (error) {
    if (!isProcessRunning(pid)) {
      clearDaemonFiles();
      return { stopped: true, reason: 'stopped', pid };
    }

    return { stopped: false, reason: 'termination_failed', pid, error: error.message };
  }

  let stopped = await waitForProcessExit(pid, 10000);
  if (!stopped && process.platform !== 'win32') {
    try {
      terminateProcess(pid, true);
    } catch {
      // Best effort.
    }
    stopped = await waitForProcessExit(pid, 5000);
  }

  if (stopped) {
    clearDaemonFiles();
    return { stopped: true, reason: 'stopped', pid };
  }

  return { stopped: false, reason: 'timeout', pid };
}

export async function getDaemonStatus({ serverPort } = {}) {
  ensureDaemonDir();

  const state = readStateFile();
  const pid = readPidFile();
  let running = false;
  let stalePid = false;

  if (pid) {
    running = isProcessRunning(pid);
    stalePid = !running;
    if (stalePid) {
      clearDaemonFiles();
    }
  }

  const resolvedPort = parsePort(
    state.serverPort ?? serverPort ?? process.env.SERVER_PORT ?? process.env.PORT
  );

  const health = running ? await checkHealth(resolvedPort) : false;
  const autostart = getAutostartStatus();

  return {
    running,
    stalePid,
    pid: running ? pid : null,
    port: resolvedPort,
    health,
    autostart,
    paths: getDaemonPaths(),
    state: running ? state : {}
  };
}

export function enableAutostart({ nodePath, cliEntryPath, serverPort, databasePath } = {}) {
  if (!nodePath || !cliEntryPath) {
    throw new Error('nodePath and cliEntryPath are required to enable autostart');
  }

  const options = { nodePath, cliEntryPath, serverPort, databasePath };

  if (process.platform === 'linux') {
    return enableLinuxAutostart(options);
  }

  if (process.platform === 'darwin') {
    return enableMacAutostart(options);
  }

  if (process.platform === 'win32') {
    return enableWindowsAutostart(options);
  }

  throw new Error(`Autostart is not supported on platform: ${process.platform}`);
}

export function disableAutostart() {
  if (process.platform === 'linux') {
    return disableLinuxAutostart();
  }

  if (process.platform === 'darwin') {
    return disableMacAutostart();
  }

  if (process.platform === 'win32') {
    return disableWindowsAutostart();
  }

  throw new Error(`Autostart is not supported on platform: ${process.platform}`);
}

export function getAutostartStatus() {
  if (process.platform === 'linux') {
    return getLinuxAutostartStatus();
  }

  if (process.platform === 'darwin') {
    return getMacAutostartStatus();
  }

  if (process.platform === 'win32') {
    return getWindowsAutostartStatus();
  }

  return { enabled: false, mode: 'unsupported', path: null };
}

export function readDaemonLogs({ lines = 200 } = {}) {
  ensureDaemonDir();
  if (!fs.existsSync(LOG_FILE)) {
    return { exists: false, content: '', logFile: LOG_FILE };
  }

  const raw = fs.readFileSync(LOG_FILE, 'utf8');
  const lineList = raw.split(/\r?\n/);
  const limited = lineList.slice(Math.max(0, lineList.length - lines)).join('\n');
  return { exists: true, content: limited.trim(), logFile: LOG_FILE };
}
