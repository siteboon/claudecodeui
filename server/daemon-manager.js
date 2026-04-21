import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { request } from 'node:http';
import net from 'node:net';

const DAEMON_SERVICE_NAME = 'cloudcli.service';
const DAEMON_USER_SERVICE_PATH = path.join(os.homedir(), '.config', 'systemd', 'user', DAEMON_SERVICE_NAME);
const DAEMON_SYSTEM_SERVICE_PATH = path.join('/etc', 'systemd', 'system', DAEMON_SERVICE_NAME);
const DAEMON_HEALTH_TIMEOUT_MS = 60000;
const DAEMON_HEALTH_REQUEST_TIMEOUT_MS = 4000;
const DAEMON_HEALTH_RETRY_INTERVAL_MS = 1000;

const DAEMON_SUBCOMMANDS = new Set([
    'install',
    'start',
    'stop',
    'restart',
    'status',
    'logs',
    'enable',
    'disable',
    'uninstall',
    'doctor',
    'help',
]);

const DAEMON_MODES = new Set(['auto', 'user', 'system']);

function passthroughColor(text) {
    return text;
}

function getColorHelpers(color) {
    if (color) {
        return color;
    }
    return {
        info: passthroughColor,
        ok: passthroughColor,
        warn: passthroughColor,
        error: passthroughColor,
        tip: passthroughColor,
        bright: passthroughColor,
        dim: passthroughColor,
    };
}

function runCommand(bin, args, opts = {}) {
    const stdio = opts.inherit ? 'inherit' : 'pipe';
    return spawnSync(bin, args, {
        encoding: 'utf8',
        stdio,
    });
}

function extractCommandError(result, fallbackMessage) {
    if (!result) return fallbackMessage;
    const fromError = result.error?.message?.trim();
    if (fromError) return fromError;
    const fromStd = (result.stderr || result.stdout || '').trim();
    if (fromStd) return fromStd;
    return fallbackMessage;
}

function quoteSystemdArg(arg) {
    return `"${String(arg).replace(/(["\\$`])/g, '\\$1')}"`;
}

function getDaemonServicePath(mode) {
    return mode === 'system' ? DAEMON_SYSTEM_SERVICE_PATH : DAEMON_USER_SERVICE_PATH;
}

function getSystemctlArgs(mode, commandArgs) {
    return mode === 'user' ? ['--user', ...commandArgs] : commandArgs;
}

function getJournalctlArgs(mode, commandArgs) {
    return mode === 'user' ? ['--user', ...commandArgs] : commandArgs;
}

function parseDaemonArgs(args) {
    const parsed = {
        subcommand: 'status',
        options: {
            mode: 'user',
        },
    };

    let i = 0;
    if (args[0] && DAEMON_SUBCOMMANDS.has(args[0])) {
        parsed.subcommand = args[0];
        i = 1;
    }

    for (; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--port' || arg === '-p') {
            parsed.options.serverPort = args[++i];
        } else if (arg.startsWith('--port=')) {
            parsed.options.serverPort = arg.split('=')[1];
        } else if (arg === '--mode' || arg === '-m') {
            parsed.options.mode = (args[++i] || '').toLowerCase();
        } else if (arg.startsWith('--mode=')) {
            parsed.options.mode = (arg.split('=')[1] || '').toLowerCase();
        } else if (arg === '--database-path') {
            parsed.options.databasePath = args[++i];
        } else if (arg.startsWith('--database-path=')) {
            parsed.options.databasePath = arg.split('=')[1];
        } else if (arg === '--help' || arg === '-h') {
            parsed.subcommand = 'help';
        } else {
            parsed.options.extraArgs = parsed.options.extraArgs || [];
            parsed.options.extraArgs.push(arg);
        }
    }

    return parsed;
}

function buildDaemonExecStart({ appRoot, serverPort, databasePath, nodeExecPath, cliEntry }) {
    const nodeExec = nodeExecPath || process.execPath || 'node';
    const cliCandidate = cliEntry
        ? path.resolve(cliEntry)
        : (process.argv[1] ? path.resolve(process.argv[1]) : path.join(appRoot, 'dist-server', 'server', 'cli.js'));
    const resolvedCliEntry = fs.existsSync(cliCandidate)
        ? cliCandidate
        : path.join(appRoot, 'dist-server', 'server', 'cli.js');

    const args = [nodeExec, resolvedCliEntry, 'start', '--port', String(serverPort)];
    if (databasePath) {
        args.push('--database-path', databasePath);
    }

    return args.map(quoteSystemdArg).join(' ');
}

function buildDaemonServiceUnit({ appRoot, serverPort, databasePath, nodeExecPath, cliEntry }) {
    const execStart = buildDaemonExecStart({
        appRoot,
        serverPort,
        databasePath,
        nodeExecPath,
        cliEntry,
    });
    return `[Unit]
Description=CloudCLI Server
After=network.target

[Service]
Type=simple
WorkingDirectory=${appRoot}
ExecStart=${execStart}
Environment=HOST=0.0.0.0
Environment=CLOUDCLI_DAEMON_MANAGED=1
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
`;
}

function normalizeState(value) {
    const text = (value || '').trim();
    if (!text) return 'unknown';
    if (/No such file or directory/i.test(text)) return 'not-found';
    return text;
}

function getState(mode) {
    const activeRes = runCommand('systemctl', getSystemctlArgs(mode, ['is-active', DAEMON_SERVICE_NAME]));
    const enabledRes = runCommand('systemctl', getSystemctlArgs(mode, ['is-enabled', DAEMON_SERVICE_NAME]));

    return {
        active: normalizeState(activeRes.stdout || activeRes.stderr),
        enabled: normalizeState(enabledRes.stdout || enabledRes.stderr),
    };
}

function readLogs(mode, lines = 100, inherit = false) {
    const args = [...getJournalctlArgs(mode, ['-u', DAEMON_SERVICE_NAME]), '-n', String(lines), '--no-pager'];
    return runCommand('journalctl', args, { inherit });
}

function getPortFromServiceUnit(servicePath) {
    if (!fs.existsSync(servicePath)) return null;
    try {
        const content = fs.readFileSync(servicePath, 'utf8');
        const quoted = content.match(/"--port"\s+"(\d+)"/);
        if (quoted) return Number(quoted[1]);
        const plain = content.match(/--port(?:\s+|=)(\d+)/);
        if (plain) return Number(plain[1]);
    } catch {
        // Ignore parse errors and use fallback port.
    }
    return null;
}

function findLatestErrorLine(logText) {
    if (!logText) return '';
    const lines = logText.split('\n').map(line => line.trim()).filter(Boolean);
    const errorLine = [...lines].reverse().find(line => /(error|failed|exception|denied|cannot|traceback)/i.test(line));
    return errorLine || '';
}

function probeUserBus() {
    const result = runCommand('systemctl', ['--user', 'show-environment']);
    return {
        ok: result.status === 0,
        detail: extractCommandError(result, 'systemd user bus is not reachable'),
    };
}

function probeLinger() {
    const result = runCommand('loginctl', ['show-user', os.userInfo().username, '-p', 'Linger']);
    if (result.status !== 0) {
        return {
            value: 'unknown',
            detail: extractCommandError(result, 'Could not read linger status'),
        };
    }
    const output = (result.stdout || '').trim();
    const value = output.includes('=') ? output.split('=')[1].trim().toLowerCase() : output.toLowerCase();
    return {
        value: value || 'unknown',
        detail: '',
    };
}

function resolveDaemonMode({ requestedMode, subcommand, userBusAvailable }) {
    if (requestedMode !== 'auto') {
        return requestedMode;
    }

    const userUnitInstalled = fs.existsSync(getDaemonServicePath('user'));
    const systemUnitInstalled = fs.existsSync(getDaemonServicePath('system'));

    if (subcommand === 'install') {
        return userBusAvailable ? 'user' : 'system';
    }

    if (userUnitInstalled) return 'user';
    if (systemUnitInstalled) return 'system';
    return userBusAvailable ? 'user' : 'system';
}

function runSystemctl(mode, commandArgs, opts = {}) {
    const result = runCommand('systemctl', getSystemctlArgs(mode, commandArgs), { inherit: opts.inherit });
    if (result.status !== 0 && !opts.allowFailure) {
        let errorText = extractCommandError(result, `systemctl ${commandArgs.join(' ')} failed`);
        if (mode === 'system' && /(access denied|permission denied|must be root|interactive authentication required|not permitted)/i.test(errorText)) {
            errorText += `\nTry running with elevated privileges (e.g. sudo cloudcli daemon ${commandArgs.join(' ')} --mode system).`;
        }
        throw new Error(errorText);
    }
    return result;
}

async function sleep(ms) {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function isPortReachable(port, timeoutMs = 1000) {
    return await new Promise(resolve => {
        const socket = net.createConnection({ host: '127.0.0.1', port: Number(port) });
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(value);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}

async function requestHealthOnce(port, timeoutMs = DAEMON_HEALTH_REQUEST_TIMEOUT_MS) {
    return await new Promise((resolve, reject) => {
        const req = request({
            host: '127.0.0.1',
            port: Number(port),
            method: 'GET',
            path: '/health',
            timeout: timeoutMs,
        }, (res) => {
            res.resume();
            resolve({ ok: true, statusCode: res.statusCode });
        });

        req.on('timeout', () => req.destroy(new Error(`Health check timed out after ${timeoutMs}ms`)));
        req.on('error', reject);
        req.end();
    });
}

async function waitForHealth(port, timeoutMs = DAEMON_HEALTH_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        try {
            return await requestHealthOnce(port);
        } catch (error) {
            lastError = error;
            if (await isPortReachable(port, 700)) {
                return { ok: true, statusCode: null, probe: 'tcp' };
            }
            await sleep(DAEMON_HEALTH_RETRY_INTERVAL_MS);
        }
    }
    throw new Error(lastError?.message || `Service did not become healthy on port ${port}`);
}

async function healthCheckOrThrow(mode, port, c) {
    const state = getState(mode);
    if (state.active !== 'active' && state.active !== 'activating') {
        throw new Error(`Service is not active (state: ${state.active})`);
    }

    try {
        const health = await waitForHealth(port);
        if (health.probe === 'tcp') {
            console.log(`${c.warn('[WARN]')} HTTP /health probe delayed; TCP port ${port} is already accepting connections.`);
        }
    } catch (healthError) {
        const logsResult = readLogs(mode, 50);
        const logText = (logsResult.stdout || logsResult.stderr || '').trim();
        const lastErrorLine = findLatestErrorLine(logText);

        if (logText) {
            console.log(`\n${c.warn('[WARN]')} Last 50 daemon log lines:`);
            console.log(logText);
        }

        if (lastErrorLine) {
            throw new Error(`Health check failed: ${healthError.message}\nLikely cause: ${lastErrorLine}`);
        }
        throw new Error(`Health check failed: ${healthError.message}`);
    }
}

function ensureLinux() {
    if (process.platform !== 'linux') {
        throw new Error('The daemon command is supported on Linux only.');
    }
}

function ensureSystemctl() {
    const probe = runCommand('systemctl', ['--version']);
    if (probe.status !== 0) {
        throw new Error(extractCommandError(probe, 'systemctl is not available in this environment'));
    }
}

function showDaemonHelp(c) {
    console.log(`
${c.bright('CloudCLI Daemon')} - Persistent Linux service manager

Usage:
  cloudcli daemon [subcommand] [options]

Subcommands:
  ${c.bright('install')}      Install/update unit, reload daemon, enable and start now
  ${c.bright('start')}        Start the service
  ${c.bright('stop')}         Stop the service (temporary; auto-start remains enabled)
  ${c.bright('restart')}      Restart the service
  ${c.bright('status')}       Show active/enabled state
  ${c.bright('logs')}         Show recent service logs
  ${c.bright('enable')}       Enable auto-start at boot
  ${c.bright('disable')}      Disable auto-start at boot
  ${c.bright('uninstall')}    Stop, disable, and remove the service unit
  ${c.bright('doctor')}       Run diagnostics (bus, linger, units, state, port, logs)
  ${c.bright('help')}         Show this help

Options:
  -p, --port <port>           Set service server port (default: 3001)
  -m, --mode <mode>           Service mode: user | system | auto (default: user)
  --database-path <path>      Set service database path

Examples:
  $ cloudcli daemon install --mode auto --port 3001
  $ cloudcli daemon status --mode auto
  $ cloudcli daemon doctor --mode auto
  $ cloudcli daemon logs --mode system
`);
}

export function hasInstalledDaemonUnit() {
    return fs.existsSync(DAEMON_USER_SERVICE_PATH) || fs.existsSync(DAEMON_SYSTEM_SERVICE_PATH);
}

export async function handleDaemonCommand(args, context = {}) {
    const c = getColorHelpers(context.color);
    const parsed = parseDaemonArgs(args);

    if (parsed.options.extraArgs?.length) {
        showDaemonHelp(c);
        throw new Error(`Unknown daemon arguments: ${parsed.options.extraArgs.join(' ')}`);
    }

    if (parsed.subcommand === 'help') {
        showDaemonHelp(c);
        return;
    }

    if (!DAEMON_MODES.has(parsed.options.mode)) {
        throw new Error(`Invalid daemon mode "${parsed.options.mode}". Use one of: auto, user, system.`);
    }

    ensureLinux();
    ensureSystemctl();

    const appRoot = context.appRoot || process.cwd();
    const defaultPort = context.defaultPort || process.env.SERVER_PORT || process.env.PORT || '3001';
    const configuredPort = parsed.options.serverPort || defaultPort;
    const databasePath = parsed.options.databasePath || process.env.DATABASE_PATH || '';

    const portNum = Number(configuredPort);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        throw new Error(`Invalid port "${configuredPort}". Expected an integer between 1 and 65535.`);
    }

    const userBus = probeUserBus();
    const mode = resolveDaemonMode({
        requestedMode: parsed.options.mode,
        subcommand: parsed.subcommand,
        userBusAvailable: userBus.ok,
    });
    const servicePath = getDaemonServicePath(mode);
    const effectivePort = getPortFromServiceUnit(servicePath) || portNum;

    if (mode === 'user' && !userBus.ok) {
        throw new Error(
            `Could not connect to your systemd user session.\n${userBus.detail}\n` +
            `Try ${c.bright('cloudcli daemon install --mode system')} or enable user linger: ${c.bright(`sudo loginctl enable-linger ${os.userInfo().username}`)}`
        );
    }

    if (parsed.subcommand === 'doctor') {
        const linger = probeLinger();
        const userUnitInstalled = fs.existsSync(getDaemonServicePath('user'));
        const systemUnitInstalled = fs.existsSync(getDaemonServicePath('system'));
        const selectedModePort = getPortFromServiceUnit(servicePath) || portNum;
        const portReachable = await isPortReachable(selectedModePort);
        const userState = userBus.ok ? getState('user') : { active: 'unavailable', enabled: 'unavailable' };
        const systemState = getState('system');
        const logsResult = readLogs(mode, 50);
        const logsText = (logsResult.stdout || logsResult.stderr || '').trim();
        const lastErrorLine = findLatestErrorLine(logsText);

        console.log(`\n${c.bright('CloudCLI Daemon Doctor')}\n`);
        console.log(`${c.info('[INFO]')} Requested mode: ${c.bright(parsed.options.mode)}`);
        console.log(`${c.info('[INFO]')} Resolved mode:  ${c.bright(mode)}`);
        console.log(`${c.info('[INFO]')} user-bus:       ${userBus.ok ? c.ok('ok') : c.warn('unavailable')}`);
        if (!userBus.ok) {
            console.log(`       ${c.dim(userBus.detail)}`);
        }
        console.log(`${c.info('[INFO]')} linger:         ${c.bright(linger.value)}${linger.detail ? ` ${c.dim(`(${linger.detail})`)}` : ''}`);
        console.log(`${c.info('[INFO]')} user unit:      ${userUnitInstalled ? c.ok('installed') : c.warn('missing')} (${c.dim(getDaemonServicePath('user'))})`);
        console.log(`${c.info('[INFO]')} system unit:    ${systemUnitInstalled ? c.ok('installed') : c.warn('missing')} (${c.dim(getDaemonServicePath('system'))})`);
        console.log(`${c.info('[INFO]')} user state:     active=${c.bright(userState.active)} enabled=${c.bright(userState.enabled)}`);
        console.log(`${c.info('[INFO]')} system state:   active=${c.bright(systemState.active)} enabled=${c.bright(systemState.enabled)}`);
        console.log(`${c.info('[INFO]')} health port:    ${c.bright(String(selectedModePort))} (${portReachable ? c.ok('reachable') : c.warn('not reachable')})`);
        if (lastErrorLine) {
            console.log(`${c.warn('[WARN]')} Latest error:   ${lastErrorLine}`);
        }

        console.log(`\n${c.bright('Machine Readable')}`);
        console.log(`MODE_REQUESTED=${parsed.options.mode}`);
        console.log(`MODE_RESOLVED=${mode}`);
        console.log(`USER_BUS_OK=${userBus.ok}`);
        console.log(`LINGER=${linger.value}`);
        console.log(`USER_UNIT_INSTALLED=${userUnitInstalled}`);
        console.log(`SYSTEM_UNIT_INSTALLED=${systemUnitInstalled}`);
        console.log(`USER_ACTIVE=${userState.active}`);
        console.log(`USER_ENABLED=${userState.enabled}`);
        console.log(`SYSTEM_ACTIVE=${systemState.active}`);
        console.log(`SYSTEM_ENABLED=${systemState.enabled}`);
        console.log(`HEALTH_PORT=${selectedModePort}`);
        console.log(`PORT_REACHABLE=${portReachable}`);
        console.log(`LAST_ERROR_LINE=${JSON.stringify(lastErrorLine || '')}\n`);
        return;
    }

    switch (parsed.subcommand) {
        case 'install': {
            if (parsed.options.mode === 'auto' && mode === 'system' && !userBus.ok) {
                console.log(`${c.warn('[WARN]')} User mode is unavailable; auto mode is falling back to system mode.`);
            }

            try {
                fs.mkdirSync(path.dirname(servicePath), { recursive: true });
                const unitContent = buildDaemonServiceUnit({
                    appRoot,
                    serverPort: portNum,
                    databasePath,
                    nodeExecPath: context.nodeExecPath,
                    cliEntry: context.cliEntry,
                });
                fs.writeFileSync(servicePath, unitContent, 'utf8');
            } catch (fileError) {
                if (mode === 'system' && (fileError.code === 'EACCES' || fileError.code === 'EPERM')) {
                    throw new Error(`Permission denied writing ${servicePath}. Try: sudo cloudcli daemon install --mode system --port ${portNum}`);
                }
                throw fileError;
            }

            runSystemctl(mode, ['daemon-reload']);
            runSystemctl(mode, ['enable', '--now', DAEMON_SERVICE_NAME]);

            if (mode === 'user') {
                const lingerResult = runCommand('loginctl', ['enable-linger', os.userInfo().username]);
                if (lingerResult.status !== 0) {
                    console.log(`${c.warn('[WARN]')} Could not enable linger automatically.`);
                    console.log(`       ${c.dim(extractCommandError(lingerResult, 'Unknown linger error'))}`);
                    console.log(`       ${c.tip('[TIP]')} Run with sufficient privileges: ${c.bright(`sudo loginctl enable-linger ${os.userInfo().username}`)}`);
                }
            }

            const installedPort = getPortFromServiceUnit(servicePath) || portNum;
            await healthCheckOrThrow(mode, installedPort, c);

            const state = getState(mode);
            console.log(`\n${c.ok('✔')} Daemon installed and started.`);
            console.log(`   Mode:    ${c.bright(mode)}`);
            console.log(`   Unit:    ${c.dim(servicePath)}`);
            console.log(`   Active:  ${c.bright(state.active)}`);
            console.log(`   Enabled: ${c.bright(state.enabled)}\n`);
            break;
        }

        case 'start':
            runSystemctl(mode, ['start', DAEMON_SERVICE_NAME]);
            await healthCheckOrThrow(mode, effectivePort, c);
            console.log(`${c.ok('[OK]')} Service started.`);
            break;

        case 'stop':
            runSystemctl(mode, ['stop', DAEMON_SERVICE_NAME]);
            console.log(`${c.ok('[OK]')} Service stopped (auto-start remains enabled).`);
            break;

        case 'restart':
            runSystemctl(mode, ['restart', DAEMON_SERVICE_NAME]);
            await healthCheckOrThrow(mode, effectivePort, c);
            console.log(`${c.ok('[OK]')} Service restarted.`);
            break;

        case 'enable':
            runSystemctl(mode, ['enable', DAEMON_SERVICE_NAME]);
            console.log(`${c.ok('[OK]')} Service enabled for auto-start.`);
            break;

        case 'disable':
            runSystemctl(mode, ['disable', DAEMON_SERVICE_NAME]);
            console.log(`${c.ok('[OK]')} Service disabled for auto-start.`);
            break;

        case 'logs': {
            const logsResult = readLogs(mode, 100, true);
            if (logsResult.status !== 0) {
                throw new Error(extractCommandError(logsResult, 'Unable to read daemon logs'));
            }
            break;
        }

        case 'uninstall': {
            runSystemctl(mode, ['stop', DAEMON_SERVICE_NAME], { allowFailure: true });
            runSystemctl(mode, ['disable', DAEMON_SERVICE_NAME], { allowFailure: true });
            if (fs.existsSync(servicePath)) {
                try {
                    fs.unlinkSync(servicePath);
                } catch (unlinkError) {
                    if (mode === 'system' && (unlinkError.code === 'EACCES' || unlinkError.code === 'EPERM')) {
                        throw new Error(`Permission denied removing ${servicePath}. Try: sudo cloudcli daemon uninstall --mode system`);
                    }
                    throw unlinkError;
                }
            }
            runSystemctl(mode, ['daemon-reload'], { allowFailure: true });
            console.log(`${c.ok('[OK]')} Daemon uninstalled.`);
            break;
        }

        case 'status':
        default: {
            const state = getState(mode);
            const unitExists = fs.existsSync(servicePath);
            const selectedPort = getPortFromServiceUnit(servicePath) || portNum;
            console.log(`\n${c.bright('CloudCLI Daemon Status')}\n`);
            console.log(`${c.info('[INFO]')} Mode:      ${c.bright(mode)} ${parsed.options.mode === 'auto' ? c.dim('(resolved from auto)') : ''}`);
            console.log(`${c.info('[INFO]')} Unit file: ${c.dim(servicePath)} ${unitExists ? c.ok('[OK]') : c.warn('[MISSING]')}`);
            console.log(`${c.info('[INFO]')} Active:    ${c.bright(state.active)}`);
            console.log(`${c.info('[INFO]')} Enabled:   ${c.bright(state.enabled)}`);
            console.log(`${c.info('[INFO]')} Port:      ${c.bright(String(selectedPort))}`);
            console.log('');
        }
    }
}
