#!/usr/bin/env node
/**
 * CloudCLI CLI
 *
 * Provides command-line utilities for managing CloudCLI
 *
 * Commands:
 *   (no args)     - Start the server (default)
 *   start         - Start the server
 *   sandbox       - Manage Docker sandbox environments
 *   daemon        - Manage persistent Linux service modes
 *   status        - Show configuration and data locations
 *   help          - Show help information
 *   version       - Show version information
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'node:net';
import { findAppRoot, getModuleDir } from './utils/runtime-paths.js';
import { buildDaemonCliCommand, handleDaemonCommand, hasInstalledDaemonUnit } from './daemon-manager.js';

const __dirname = getModuleDir(import.meta.url);
// The CLI is compiled into dist-server/server, but it still needs to read the top-level
// package.json and .env file. Resolving the app root once keeps those lookups stable.
const APP_ROOT = findAppRoot(__dirname);
const DAEMON_COMMAND_CONTEXT = {
    appRoot: APP_ROOT,
    cliEntry: process.argv[1],
    nodeExecPath: process.execPath,
};

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',

    // Foreground colors
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
};

// Helper to colorize text
const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    ok: (text) => `${colors.green}${text}${colors.reset}`,
    warn: (text) => `${colors.yellow}${text}${colors.reset}`,
    error: (text) => `${colors.yellow}${text}${colors.reset}`,
    tip: (text) => `${colors.blue}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

// Load package.json for version info
const packageJsonPath = path.join(APP_ROOT, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
// Match the runtime fallback in load-env.js so "cloudcli status" reports the same default
// database location that the backend will actually use when no DATABASE_PATH is configured.
const DEFAULT_DATABASE_PATH = path.join(os.homedir(), '.cloudcli', 'auth.db');

// Load environment variables from .env file if it exists
function loadEnvFile() {
    try {
        const envPath = path.join(APP_ROOT, '.env');
        const envFile = fs.readFileSync(envPath, 'utf8');
        envFile.split('\n').forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, ...valueParts] = trimmedLine.split('=');
                if (key && valueParts.length > 0 && !process.env[key]) {
                    process.env[key] = valueParts.join('=').trim();
                }
            }
        });
    } catch (e) {
        // .env file is optional
    }
}

// Get the database path (same logic as db.js)
function getDatabasePath() {
    loadEnvFile();
    return process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;
}

// Get the installation directory
function getInstallDir() {
    return APP_ROOT;
}

// Show status command
function showStatus() {
    console.log(`\n${c.bright('CloudCLI UI - Status')}\n`);
    console.log(c.dim('═'.repeat(60)));

    // Version info
    console.log(`\n${c.info('[INFO]')} Version: ${c.bright(packageJson.version)}`);

    // Installation location
    const installDir = getInstallDir();
    console.log(`\n${c.info('[INFO]')} Installation Directory:`);
    console.log(`       ${c.dim(installDir)}`);

    // Database location
    const dbPath = getDatabasePath();
    const dbExists = fs.existsSync(dbPath);
    console.log(`\n${c.info('[INFO]')} Database Location:`);
    console.log(`       ${c.dim(dbPath)}`);
    console.log(`       Status: ${dbExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not created yet (will be created on first run)')}`);

    if (dbExists) {
        const stats = fs.statSync(dbPath);
        console.log(`       Size: ${c.dim((stats.size / 1024).toFixed(2) + ' KB')}`);
        console.log(`       Modified: ${c.dim(stats.mtime.toLocaleString())}`);
    }

    // Environment variables
    console.log(`\n${c.info('[INFO]')} Configuration:`);
    console.log(`       SERVER_PORT: ${c.bright(process.env.SERVER_PORT || process.env.PORT || '3001')} ${c.dim(process.env.SERVER_PORT || process.env.PORT ? '' : '(default)')}`);
    console.log(`       DATABASE_PATH: ${c.dim(process.env.DATABASE_PATH || '(using default location)')}`);
    console.log(`       CLAUDE_CLI_PATH: ${c.dim(process.env.CLAUDE_CLI_PATH || 'claude (default)')}`);
    console.log(`       CONTEXT_WINDOW: ${c.dim(process.env.CONTEXT_WINDOW || '160000 (default)')}`);

    // Claude projects folder
    const claudeProjectsPath = path.join(os.homedir(), '.claude', 'projects');
    const projectsExists = fs.existsSync(claudeProjectsPath);
    console.log(`\n${c.info('[INFO]')} Claude Projects Folder:`);
    console.log(`       ${c.dim(claudeProjectsPath)}`);
    console.log(`       Status: ${projectsExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not found')}`);

    // Config file location
    const envFilePath = path.join(APP_ROOT, '.env');
    const envExists = fs.existsSync(envFilePath);
    console.log(`\n${c.info('[INFO]')} Configuration File:`);
    console.log(`       ${c.dim(envFilePath)}`);
    console.log(`       Status: ${envExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not found (using defaults)')}`);

    console.log('\n' + c.dim('═'.repeat(60)));
    console.log(`\n${c.tip('[TIP]')} Hints:`);
    console.log(`      ${c.dim('>')} Use ${c.bright('cloudcli --port 8080')} to run on a custom port`);
    console.log(`      ${c.dim('>')} Use ${c.bright('cloudcli --database-path /path/to/db')} for custom database`);
    console.log(`      ${c.dim('>')} Run ${c.bright('cloudcli help')} for all options`);
    console.log(`      ${c.dim('>')} Access the UI at http://localhost:${process.env.SERVER_PORT || process.env.PORT || '3001'}\n`);
}

// Show help
function showHelp() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              CloudCLI - Command Line Tool               ║
╚═══════════════════════════════════════════════════════════════╝

Usage:
  claude-code-ui [command] [options]
  cloudcli [command] [options]

Commands:
  start          Start the CloudCLI server (default)
  daemon         Manage persistent Linux service (system-first)
  sandbox        Manage Docker sandbox environments
  status         Show configuration and data locations
  update         Update to the latest version
  help           Show this help information
  version        Show version information

Options:
  -p, --port <port>           Set server port (default: 3001)
  --database-path <path>      Set custom database location
  --no-daemon                 Disable automatic daemon startup on Linux
  --restart-daemon            Restart daemon automatically after update
  -h, --help                  Show this help information
  -v, --version               Show version information

Examples:
  $ cloudcli                        # Start with defaults
  $ cloudcli --port 8080            # Start on port 8080
  $ cloudcli --no-daemon            # Force foreground mode
  $ sudo cloudcli daemon install --mode system --port 3001
  $ cloudcli daemon install --mode user --port 3001 --frontend-port 5173
  $ cloudcli daemon doctor --mode system
  $ cloudcli update --restart-daemon
  $ cloudcli sandbox ~/my-project   # Run in a Docker sandbox
  $ cloudcli status                 # Show configuration

Environment Variables:
  SERVER_PORT         Set server port (default: 3001)
  PORT                Set server port (default: 3001) (LEGACY)
  DATABASE_PATH       Set custom database location
  CLAUDE_CLI_PATH     Set custom Claude CLI path
  CONTEXT_WINDOW      Set context window size (default: 160000)

Documentation:
  ${packageJson.homepage || 'https://github.com/siteboon/claudecodeui'}

Report Issues:
  ${packageJson.bugs?.url || 'https://github.com/siteboon/claudecodeui/issues'}
`);
}

// Show version
function showVersion() {
    console.log(`${packageJson.version}`);
}

// Compare semver versions, returns true if v1 > v2
function isNewerVersion(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (parts1[i] > parts2[i]) return true;
        if (parts1[i] < parts2[i]) return false;
    }
    return false;
}

// Check for updates
async function checkForUpdates(silent = false) {
    try {
        const { execSync } = await import('child_process');
        const latestVersion = execSync('npm show @cloudcli-ai/cloudcli version', { encoding: 'utf8' }).trim();
        const currentVersion = packageJson.version;

        if (isNewerVersion(latestVersion, currentVersion)) {
            console.log(`\n${c.warn('[UPDATE]')} New version available: ${c.bright(latestVersion)} (current: ${currentVersion})`);
            console.log(`         Run ${c.bright('cloudcli update')} to update\n`);
            return { hasUpdate: true, latestVersion, currentVersion };
        } else if (!silent) {
            console.log(`${c.ok('[OK]')} You are on the latest version (${currentVersion})`);
        }
        return { hasUpdate: false, latestVersion, currentVersion };
    } catch (e) {
        if (!silent) {
            console.log(`${c.warn('[WARN]')} Could not check for updates`);
        }
        return { hasUpdate: false, error: e.message };
    }
}

// Update the package
async function updatePackage(options = {}) {
    try {
        const { execSync } = await import('child_process');
        console.log(`${c.info('[INFO]')} Checking for updates...`);

        const { hasUpdate, latestVersion, currentVersion } = await checkForUpdates(true);

        if (!hasUpdate) {
            console.log(`${c.ok('[OK]')} Already on the latest version (${currentVersion})`);
            return;
        }

        console.log(`${c.info('[INFO]')} Updating from ${currentVersion} to ${latestVersion}...`);
        execSync('npm update -g @cloudcli-ai/cloudcli', { stdio: 'inherit' });
        console.log(`${c.ok('[OK]')} Update complete!`);

        if (options.restartDaemon) {
            if (!hasInstalledDaemonUnit()) {
                console.log(`${c.warn('[WARN]')} No daemon unit detected; skipping restart.`);
                return;
            }
            console.log(`${c.info('[INFO]')} Restarting daemon service...`);
            await handleDaemonCommand(['restart', '--mode=system'], {
                appRoot: APP_ROOT,
                defaultPort: process.env.SERVER_PORT || process.env.PORT || '3001',
                color: c,
            });
            console.log(`${c.ok('[OK]')} Daemon restart completed.`);
        } else if (hasInstalledDaemonUnit()) {
            const restartCommand = buildDaemonCliCommand(
                { subcommand: 'restart', mode: 'system' },
                DAEMON_COMMAND_CONTEXT
            );
            console.log(`${c.tip('[TIP]')} Daemon unit detected. Restart to apply update: ${c.bright(restartCommand)}`);
            console.log(`${c.tip('[TIP]')} Or update + restart in one step: ${c.bright('cloudcli update --restart-daemon')}`);
        } else {
            console.log(`${c.tip('[TIP]')} Restart cloudcli to use the new version.`);
        }
    } catch (e) {
        console.error(`${c.error('[ERROR]')} Update failed: ${e.message}`);
        console.log(`${c.tip('[TIP]')} Try running manually: npm update -g @cloudcli-ai/cloudcli`);
    }
}

// ── Sandbox command ─────────────────────────────────────────

const SANDBOX_TEMPLATES = {
    claude: 'docker.io/cloudcliai/sandbox:claude-code',
    codex: 'docker.io/cloudcliai/sandbox:codex',
    gemini: 'docker.io/cloudcliai/sandbox:gemini',
};

const SANDBOX_SECRETS = {
    claude: 'anthropic',
    codex: 'openai',
    gemini: 'google',
};

function parseSandboxArgs(args) {
    const result = {
        subcommand: null,
        workspace: null,
        agent: 'claude',
        name: null,
        port: 3001,
        template: null,
        env: [],
    };

    const subcommands = ['ls', 'stop', 'start', 'rm', 'logs', 'help'];

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (i === 0 && subcommands.includes(arg)) {
            result.subcommand = arg;
        } else if (arg === '--agent' || arg === '-a') {
            result.agent = args[++i];
        } else if (arg === '--name' || arg === '-n') {
            result.name = args[++i];
        } else if (arg === '--port') {
            result.port = parseInt(args[++i], 10);
        } else if (arg === '--template' || arg === '-t') {
            result.template = args[++i];
        } else if (arg === '--env' || arg === '-e') {
            result.env.push(args[++i]);
        } else if (!arg.startsWith('-')) {
            if (!result.subcommand) {
                result.workspace = arg;
            } else {
                result.name = arg; // for stop/start/rm/logs <name>
            }
        }
    }

    // Default subcommand based on what we got
    if (!result.subcommand) {
        result.subcommand = 'create';
    }

    // Derive name from workspace path if not set
    if (!result.name && result.workspace) {
        result.name = path.basename(path.resolve(result.workspace.replace(/^~/, os.homedir())));
    }

    // Default template from agent
    if (!result.template) {
        result.template = SANDBOX_TEMPLATES[result.agent] || SANDBOX_TEMPLATES.claude;
    }

    return result;
}

function showSandboxHelp() {
    console.log(`
${c.bright('CloudCLI Sandbox')} — Run CloudCLI inside Docker Sandboxes

Usage:
  cloudcli sandbox <workspace>            Create and start a sandbox
  cloudcli sandbox <subcommand> [name]    Manage sandboxes

Subcommands:
  ${c.bright('(default)')}    Create a sandbox and start the web UI
  ${c.bright('ls')}           List all sandboxes
  ${c.bright('start')}        Restart a stopped sandbox and re-launch the web UI
  ${c.bright('stop')}         Stop a sandbox (preserves state)
  ${c.bright('rm')}           Remove a sandbox
  ${c.bright('logs')}         Show CloudCLI server logs
  ${c.bright('help')}         Show this help

Options:
  -a, --agent <agent>       Agent to use: claude, codex, gemini (default: claude)
  -n, --name <name>         Sandbox name (default: derived from workspace folder)
  -t, --template <image>    Custom template image
  -e, --env <KEY=VALUE>     Set environment variable (repeatable)
      --port <port>         Host port for the web UI (default: 3001)

Examples:
  $ cloudcli sandbox ~/my-project
  $ cloudcli sandbox ~/my-project --agent codex --port 8080
  $ cloudcli sandbox ~/my-project --env SERVER_PORT=8080 --env HOST=0.0.0.0
  $ cloudcli sandbox ls
  $ cloudcli sandbox stop my-project
  $ cloudcli sandbox start my-project
  $ cloudcli sandbox rm my-project

Prerequisites:
  1. Install sbx CLI: https://docs.docker.com/ai/sandboxes/get-started/
  2. Authenticate and store your API key:
       sbx login
       sbx secret set -g anthropic   # for Claude
       sbx secret set -g openai      # for Codex
       sbx secret set -g google      # for Gemini

Advanced usage:
  For branch mode, multiple workspaces, memory limits, network policies,
  or passing prompts to the agent, use sbx directly with the template:

    sbx run --template docker.io/cloudcliai/sandbox:claude-code claude ~/my-project --branch my-feature
    sbx run --template docker.io/cloudcliai/sandbox:claude-code claude ~/project ~/libs:ro --memory 8g

  Full Docker Sandboxes docs: https://docs.docker.com/ai/sandboxes/usage/
`);
}

async function sandboxCommand(args) {
    const { execFileSync, spawn: spawnProcess } = await import('child_process');

    // Safe execution — uses execFileSync (no shell) to prevent injection
    const sbx = (subcmd, opts = {}) => {
        const result = execFileSync('sbx', subcmd, {
            encoding: 'utf8',
            stdio: opts.inherit ? 'inherit' : 'pipe',
        });
        return result || '';
    };

    const opts = parseSandboxArgs(args);

    if (opts.subcommand === 'help') {
        showSandboxHelp();
        return;
    }

    // Validate name (alphanumeric, hyphens, underscores only)
    if (opts.name && !/^[\w-]+$/.test(opts.name)) {
        console.error(`\n${c.error('❌')} Invalid sandbox name: ${opts.name}`);
        console.log(`   Names may only contain letters, numbers, hyphens, and underscores.\n`);
        process.exit(1);
    }

    // Check sbx is installed
    try {
        sbx(['version']);
    } catch {
        console.error(`\n${c.error('❌')} ${c.bright('sbx')} CLI not found.\n`);
        console.log(`   Install it from: ${c.info('https://docs.docker.com/ai/sandboxes/get-started/')}`);
        console.log(`   Then run: ${c.bright('sbx login')}`);
        console.log(`   And store your API key: ${c.bright('sbx secret set -g anthropic')}\n`);
        process.exit(1);
    }

    switch (opts.subcommand) {

        case 'ls':
            sbx(['ls'], { inherit: true });
            break;

        case 'stop':
            if (!opts.name) {
                console.error(`\n${c.error('❌')} Sandbox name required: cloudcli sandbox stop <name>\n`);
                process.exit(1);
            }
            sbx(['stop', opts.name], { inherit: true });
            break;

        case 'rm':
            if (!opts.name) {
                console.error(`\n${c.error('❌')} Sandbox name required: cloudcli sandbox rm <name>\n`);
                process.exit(1);
            }
            sbx(['rm', opts.name], { inherit: true });
            break;

        case 'logs':
            if (!opts.name) {
                console.error(`\n${c.error('❌')} Sandbox name required: cloudcli sandbox logs <name>\n`);
                process.exit(1);
            }
            try {
                sbx(['exec', opts.name, 'bash', '-c', 'cat /tmp/cloudcli-ui.log'], { inherit: true });
            } catch (e) {
                console.error(`\n${c.error('❌')} Could not read logs: ${e.message || 'Is the sandbox running?'}\n`);
            }
            break;

        case 'start': {
            if (!opts.name) {
                console.error(`\n${c.error('❌')} Sandbox name required: cloudcli sandbox start <name>\n`);
                process.exit(1);
            }
            console.log(`\n${c.info('▶')} Starting sandbox ${c.bright(opts.name)}...`);
            const restartRun = spawnProcess('sbx', ['run', opts.name], {
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
            });
            restartRun.unref();
            await new Promise(resolve => setTimeout(resolve, 5000));

            console.log(`${c.info('▶')} Launching CloudCLI web server...`);
            sbx(['exec', opts.name, 'bash', '-c', 'cloudcli start --port 3001 &']);

            console.log(`${c.info('▶')} Forwarding port ${opts.port} → 3001...`);
            try {
                sbx(['ports', opts.name, '--publish', `${opts.port}:3001`]);
            } catch (e) {
                const msg = e.stdout || e.stderr || e.message || '';
                if (msg.includes('address already in use')) {
                    const altPort = opts.port + 1;
                    console.log(`${c.warn('⚠')}  Port ${opts.port} in use, trying ${altPort}...`);
                    try {
                        sbx(['ports', opts.name, '--publish', `${altPort}:3001`]);
                        opts.port = altPort;
                    } catch {
                        console.error(`${c.error('❌')} Ports ${opts.port} and ${altPort} both in use. Use --port to specify a free port.`);
                        process.exit(1);
                    }
                } else {
                    throw e;
                }
            }

            console.log(`\n${c.ok('✔')} ${c.bright('CloudCLI is ready!')}`);
            console.log(`  ${c.info('→')} ${c.bright(`http://localhost:${opts.port}`)}\n`);
            break;
        }

        case 'create': {
            if (!opts.workspace) {
                console.error(`\n${c.error('❌')} Workspace path required: cloudcli sandbox <path>\n`);
                console.log(`   Example: ${c.bright('cloudcli sandbox ~/my-project')}\n`);
                process.exit(1);
            }

            const workspace = opts.workspace.startsWith('~')
                ? opts.workspace.replace(/^~/, os.homedir())
                : path.resolve(opts.workspace);

            if (!fs.existsSync(workspace)) {
                console.error(`\n${c.error('❌')} Workspace path not found: ${c.dim(workspace)}\n`);
                process.exit(1);
            }

            const secret = SANDBOX_SECRETS[opts.agent] || 'anthropic';

            // Check if the required secret is stored
            try {
                const secretList = sbx(['secret', 'ls']);
                if (!secretList.includes(secret)) {
                    console.error(`\n${c.error('❌')} No ${c.bright(secret)} API key found.\n`);
                    console.log(`   Run: ${c.bright(`sbx secret set -g ${secret}`)}\n`);
                    process.exit(1);
                }
            } catch { /* sbx secret ls not available, skip check */ }

            console.log(`\n${c.bright('CloudCLI Sandbox')}`);
            console.log(c.dim('─'.repeat(50)));
            console.log(`  Agent:     ${c.info(opts.agent)} ${c.dim(`(${secret} credentials)`)}`);
            console.log(`  Workspace: ${c.dim(workspace)}`);
            console.log(`  Name:      ${c.dim(opts.name)}`);
            console.log(`  Template:  ${c.dim(opts.template)}`);
            console.log(`  Port:      ${c.dim(String(opts.port))}`);
            if (opts.env.length > 0) {
                console.log(`  Env:       ${c.dim(opts.env.join(', '))}`);
            }
            console.log(c.dim('─'.repeat(50)));

            // Step 1: Launch sandbox with sbx run in background.
            // sbx run creates the sandbox (or reconnects) AND holds an active session,
            // which prevents the sandbox from auto-stopping.
            console.log(`\n${c.info('▶')} Creating sandbox ${c.bright(opts.name)}...`);
            const bgRun = spawnProcess('sbx', [
                'run', '--template', opts.template, '--name', opts.name, opts.agent, workspace,
            ], {
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
            });
            bgRun.unref();
            // Wait for sandbox to be ready
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Step 2: Inject environment variables
            if (opts.env.length > 0) {
                console.log(`${c.info('▶')} Setting environment variables...`);
                const exports = opts.env
                    .filter(e => /^\w+=.+$/.test(e))
                    .map(e => `export ${e}`)
                    .join('\n');
                if (exports) {
                    sbx(['exec', opts.name, 'bash', '-c', `echo '${exports}' >> /etc/sandbox-persistent.sh`]);
                }
                const invalid = opts.env.filter(e => !/^\w+=.+$/.test(e));
                if (invalid.length > 0) {
                    console.log(`${c.warn('⚠')}  Skipped invalid env vars: ${invalid.join(', ')} (expected KEY=VALUE)`);
                }
            }

            // Step 3: Start CloudCLI inside the sandbox
            console.log(`${c.info('▶')} Launching CloudCLI web server...`);
            sbx(['exec', opts.name, 'bash', '-c', 'cloudcli start --port 3001 &']);

            // Step 4: Forward port
            console.log(`${c.info('▶')} Forwarding port ${opts.port} → 3001...`);
            try {
                sbx(['ports', opts.name, '--publish', `${opts.port}:3001`]);
            } catch (e) {
                const msg = e.stdout || e.stderr || e.message || '';
                if (msg.includes('address already in use')) {
                    const altPort = opts.port + 1;
                    console.log(`${c.warn('⚠')}  Port ${opts.port} in use, trying ${altPort}...`);
                    try {
                        sbx(['ports', opts.name, '--publish', `${altPort}:3001`]);
                        opts.port = altPort;
                    } catch {
                        console.error(`${c.error('❌')} Ports ${opts.port} and ${altPort} both in use. Use --port to specify a free port.`);
                        process.exit(1);
                    }
                } else {
                    throw e;
                }
            }

            // Done
            console.log(`\n${c.ok('✔')} ${c.bright('CloudCLI is ready!')}`);
            console.log(`  ${c.info('→')} Open ${c.bright(`http://localhost:${opts.port}`)}`);
            console.log(`\n${c.dim('  Manage with:')}`);
            console.log(`  ${c.dim('$')} sbx ls`);
            console.log(`  ${c.dim('$')} sbx stop ${opts.name}`);
            console.log(`  ${c.dim('$')} sbx start ${opts.name}`);
            console.log(`  ${c.dim('$')} sbx rm ${opts.name}`);
            console.log(`\n${c.dim('  Or install globally:')} npm install -g @cloudcli-ai/cloudcli\n`);
            break;
        }

        default:
            showSandboxHelp();
    }
}

// ── Server ──────────────────────────────────────────────────

// Start the server
async function startServer() {
    // Check for updates silently on startup
    checkForUpdates(true);

    // Import and run the server
    await import('./index.js');
}

async function isPortOpen(port, timeoutMs = 800) {
    return await new Promise((resolve) => {
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

async function waitForPortOpen(port, timeoutMs = 25000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isPortOpen(port)) {
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return false;
}

function printSystemDaemonActiveNotice(port) {
    const effectivePort = Number(port) || 3001;
    const statusCommand = buildDaemonCliCommand(
        { subcommand: 'status', mode: 'system' },
        DAEMON_COMMAND_CONTEXT
    );
    const stopCommand = buildDaemonCliCommand(
        { subcommand: 'stop', mode: 'system' },
        DAEMON_COMMAND_CONTEXT
    );
    const logsCommand = buildDaemonCliCommand(
        { subcommand: 'logs', mode: 'system' },
        DAEMON_COMMAND_CONTEXT
    );
    console.log(`${c.ok('[OK]')} System daemon is active and managing CloudCLI.`);
    console.log(`${c.info('[INFO]')} Health URL: ${c.bright(`http://localhost:${effectivePort}/health`)}`);
    console.log(`${c.info('[INFO]')} Status: ${c.bright(statusCommand)}`);
    console.log(`${c.info('[INFO]')} Stop: ${c.bright(stopCommand)}`);
    console.log(`${c.info('[INFO]')} Logs: ${c.bright(logsCommand)}`);
}

function printUserDaemonActiveNotice(port, frontendPort) {
    const effectivePort = Number(port) || 3001;
    const effectiveFrontendPort = Number(frontendPort) || 5173;
    const statusCommand = buildDaemonCliCommand(
        { subcommand: 'status', mode: 'user' },
        DAEMON_COMMAND_CONTEXT
    );
    const stopCommand = buildDaemonCliCommand(
        { subcommand: 'stop', mode: 'user' },
        DAEMON_COMMAND_CONTEXT
    );
    const logsCommand = buildDaemonCliCommand(
        { subcommand: 'logs', mode: 'user' },
        DAEMON_COMMAND_CONTEXT
    );
    console.log(`${c.ok('[OK]')} User daemon is active for this account.`);
    console.log(`${c.info('[INFO]')} Backend: ${c.bright(`http://localhost:${effectivePort}`)}`);
    console.log(`${c.info('[INFO]')} Frontend: ${c.bright(`http://localhost:${effectiveFrontendPort}`)}`);
    console.log(`${c.info('[INFO]')} Status: ${c.bright(statusCommand)}`);
    console.log(`${c.info('[INFO]')} Stop: ${c.bright(stopCommand)}`);
    console.log(`${c.info('[INFO]')} Logs: ${c.bright(logsCommand)}`);
    console.log(`${c.tip('[TIP]')} For login/reboot persistence, enable linger once: ${c.bright(`sudo loginctl enable-linger ${os.userInfo().username}`)}`);
}

function isSystemPermissionError(error) {
    const message = String(error?.message || error || '');
    return /(access denied|permission denied|must be root|interactive authentication required|not permitted|failed to connect to bus|operation not permitted|authentication is required|polkit)/i.test(message);
}

function buildAutoInstallArgs(mode, options, frontendPort) {
    const args = ['install', `--mode=${mode}`];
    if (options.serverPort) {
        args.push('--port', String(options.serverPort));
    }
    if (options.databasePath) {
        args.push('--database-path', String(options.databasePath));
    }
    if (frontendPort) {
        args.push('--frontend-port', String(frontendPort));
    }
    return args;
}

async function maybeAutoDaemonStart(options = {}) {
    if (process.platform !== 'linux') return false;
    if (process.env.CLOUDCLI_DAEMON_MANAGED === '1') return false;
    if (process.env.CLOUDCLI_NO_DAEMON === '1') return false;
    if (process.env.CLOUDCLI_DAEMON_ATTEMPTED === '1') return false;
    if (options.noDaemon) return false;

    process.env.CLOUDCLI_DAEMON_ATTEMPTED = '1';
    const daemonPort = Number(options.serverPort || process.env.SERVER_PORT || process.env.PORT || '3001');
    const frontendPort = Number(process.env.VITE_PORT || '5173');
    const systemArgs = buildAutoInstallArgs('system', options, frontendPort);
    const userArgs = buildAutoInstallArgs('user', options, frontendPort);

    try {
        console.log(`${c.info('[INFO]')} Linux detected. Enforcing system daemon mode for CloudCLI...`);
        await handleDaemonCommand(systemArgs, {
            appRoot: APP_ROOT,
            defaultPort: process.env.SERVER_PORT || process.env.PORT || '3001',
            color: c,
        });
        return true;
    } catch (systemError) {
        const healthySoon = await waitForPortOpen(daemonPort);
        if (healthySoon) {
            console.log(`${c.warn('[WARN]')} System daemon health check was delayed, but port ${daemonPort} is now reachable.`);
            printSystemDaemonActiveNotice(daemonPort);
            return true;
        }

        if (!isSystemPermissionError(systemError)) {
            const installSystemCommand = buildDaemonCliCommand(
                {
                    subcommand: 'install',
                    mode: 'system',
                    extraArgs: ['--port', String(daemonPort), '--frontend-port', String(frontendPort)],
                },
                DAEMON_COMMAND_CONTEXT
            );
            throw new Error(
                `System daemon bootstrap failed.\n` +
                `${systemError.message}\n` +
                `Run with privileges: ${installSystemCommand}`
            );
        }

        console.log(`${c.warn('[WARN]')} System daemon setup requires elevated privileges for this user.`);
        console.log(`${c.info('[INFO]')} Falling back to user daemon mode for account "${os.userInfo().username}"...`);

        try {
            await handleDaemonCommand(userArgs, {
                appRoot: APP_ROOT,
                defaultPort: process.env.SERVER_PORT || process.env.PORT || '3001',
                color: c,
            });
            printUserDaemonActiveNotice(daemonPort, frontendPort);
            return true;
        } catch (userError) {
            const userHealthySoon = await waitForPortOpen(daemonPort);
            if (userHealthySoon) {
                console.log(`${c.warn('[WARN]')} User daemon health check was delayed, but port ${daemonPort} is now reachable.`);
                printUserDaemonActiveNotice(daemonPort, frontendPort);
                return true;
            }
            const installSystemCommand = buildDaemonCliCommand(
                {
                    subcommand: 'install',
                    mode: 'system',
                    extraArgs: ['--port', String(daemonPort), '--frontend-port', String(frontendPort)],
                },
                DAEMON_COMMAND_CONTEXT
            );
            const installUserCommand = buildDaemonCliCommand(
                {
                    subcommand: 'install',
                    mode: 'user',
                    extraArgs: ['--port', String(daemonPort), '--frontend-port', String(frontendPort)],
                },
                DAEMON_COMMAND_CONTEXT
            );
            throw new Error(
                `System daemon bootstrap failed.\n` +
                `${systemError.message}\n\n` +
                `User daemon fallback also failed.\n` +
                `${userError.message}\n` +
                `Try one of:\n` +
                `1) ${installSystemCommand}\n` +
                `2) ${installUserCommand}`
            );
        }
    }
}

// Parse CLI arguments
function parseArgs(args) {
    const parsed = { command: 'start', options: {} };
    let commandSet = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--port' || arg === '-p') {
            parsed.options.serverPort = args[++i];
        } else if (arg.startsWith('--port=')) {
            parsed.options.serverPort = arg.split('=')[1];
        } else if (arg === '--database-path') {
            parsed.options.databasePath = args[++i];
        } else if (arg.startsWith('--database-path=')) {
            parsed.options.databasePath = arg.split('=')[1];
        } else if (arg === '--no-daemon') {
            parsed.options.noDaemon = true;
        } else if (arg === '--restart-daemon') {
            parsed.options.restartDaemon = true;
        } else if (arg === '--help' || arg === '-h') {
            parsed.command = 'help';
            commandSet = true;
        } else if (arg === '--version' || arg === '-v') {
            parsed.command = 'version';
            commandSet = true;
        } else if (!arg.startsWith('-')) {
            if (!commandSet) {
                parsed.command = arg;
                commandSet = true;
            }
            if (arg === 'sandbox' || arg === 'daemon') {
                parsed.remainingArgs = args.slice(i + 1);
                break;
            }
        }
    }

    return parsed;
}

// Main CLI handler
async function main() {
    const args = process.argv.slice(2);
    const { command, options, remainingArgs } = parseArgs(args);

    // Apply CLI options to environment variables
    if (options.serverPort) {
        process.env.SERVER_PORT = options.serverPort;
    } else if (!process.env.SERVER_PORT && process.env.PORT) {
        process.env.SERVER_PORT = process.env.PORT;
    }
    if (options.noDaemon) {
        process.env.CLOUDCLI_NO_DAEMON = '1';
    }
    if (options.databasePath) {
        process.env.DATABASE_PATH = options.databasePath;
    }

    switch (command) {
        case 'start':
            if (await maybeAutoDaemonStart(options)) {
                break;
            }
            await startServer();
            break;
        case 'sandbox':
            await sandboxCommand(remainingArgs || []);
            break;
        case 'daemon':
            await handleDaemonCommand(remainingArgs || [], {
                appRoot: APP_ROOT,
                defaultPort: process.env.SERVER_PORT || process.env.PORT || '3001',
                color: c,
                cliEntry: process.argv[1],
                nodeExecPath: process.execPath,
            });
            break;
        case 'status':
        case 'info':
            showStatus();
            break;
        case 'help':
        case '-h':
        case '--help':
            showHelp();
            break;
        case 'version':
        case '-v':
        case '--version':
            showVersion();
            break;
        case 'update':
            await updatePackage(options);
            break;
        default:
            console.error(`\n❌ Unknown command: ${command}`);
            console.log('   Run "cloudcli help" for usage information.\n');
            process.exit(1);
    }
}

// Run the CLI
main().catch(error => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
});
