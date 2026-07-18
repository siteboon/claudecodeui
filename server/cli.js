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
 *   browser-use-mcp - Run Browser MCP stdio server
 *   status        - Show configuration and data locations
 *   help          - Show help information
 *   version       - Show version information
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

import {
    findApplicationRoot,
    getModuleDirectory,
    terminalTextStyles,
} from './shared/utils.js';

const __dirname = getModuleDirectory(import.meta.url);
// The CLI is compiled into dist-server/server, but it still needs to read the top-level
// package.json and .env file. Resolving the app root once keeps those lookups stable.
const APP_ROOT = findApplicationRoot(__dirname);

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
    console.log(`\n${terminalTextStyles.bright('CloudCLI UI - Status')}\n`);
    console.log(terminalTextStyles.dim('═'.repeat(60)));

    // Version info
    console.log(`\n${terminalTextStyles.info('[INFO]')} Version: ${terminalTextStyles.bright(packageJson.version)}`);

    // Installation location
    const installDir = getInstallDir();
    console.log(`\n${terminalTextStyles.info('[INFO]')} Installation Directory:`);
    console.log(`       ${terminalTextStyles.dim(installDir)}`);

    // Database location
    const dbPath = getDatabasePath();
    const dbExists = fs.existsSync(dbPath);
    console.log(`\n${terminalTextStyles.info('[INFO]')} Database Location:`);
    console.log(`       ${terminalTextStyles.dim(dbPath)}`);
    console.log(`       Status: ${dbExists ? terminalTextStyles.ok('[OK] Exists') : terminalTextStyles.warn('[WARN] Not created yet (will be created on first run)')}`);

    if (dbExists) {
        const stats = fs.statSync(dbPath);
        console.log(`       Size: ${terminalTextStyles.dim((stats.size / 1024).toFixed(2) + ' KB')}`);
        console.log(`       Modified: ${terminalTextStyles.dim(stats.mtime.toLocaleString())}`);
    }

    // Environment variables
    console.log(`\n${terminalTextStyles.info('[INFO]')} Configuration:`);
    console.log(`       SERVER_PORT: ${terminalTextStyles.bright(process.env.SERVER_PORT || process.env.PORT || '3001')} ${terminalTextStyles.dim(process.env.SERVER_PORT || process.env.PORT ? '' : '(default)')}`);
    console.log(`       DATABASE_PATH: ${terminalTextStyles.dim(process.env.DATABASE_PATH || '(using default location)')}`);
    console.log(`       CLAUDE_CLI_PATH: ${terminalTextStyles.dim(process.env.CLAUDE_CLI_PATH || 'claude (default)')}`);
    console.log(`       CONTEXT_WINDOW: ${terminalTextStyles.dim(process.env.CONTEXT_WINDOW || '160000 (default)')}`);

    // Claude projects folder
    const claudeProjectsPath = path.join(os.homedir(), '.claude', 'projects');
    const projectsExists = fs.existsSync(claudeProjectsPath);
    console.log(`\n${terminalTextStyles.info('[INFO]')} Claude Projects Folder:`);
    console.log(`       ${terminalTextStyles.dim(claudeProjectsPath)}`);
    console.log(`       Status: ${projectsExists ? terminalTextStyles.ok('[OK] Exists') : terminalTextStyles.warn('[WARN] Not found')}`);

    // Config file location
    const envFilePath = path.join(APP_ROOT, '.env');
    const envExists = fs.existsSync(envFilePath);
    console.log(`\n${terminalTextStyles.info('[INFO]')} Configuration File:`);
    console.log(`       ${terminalTextStyles.dim(envFilePath)}`);
    console.log(`       Status: ${envExists ? terminalTextStyles.ok('[OK] Exists') : terminalTextStyles.warn('[WARN] Not found (using defaults)')}`);

    console.log('\n' + terminalTextStyles.dim('═'.repeat(60)));
    console.log(`\n${terminalTextStyles.tip('[TIP]')} Hints:`);
    console.log(`      ${terminalTextStyles.dim('>')} Use ${terminalTextStyles.bright('cloudcli --port 8080')} to run on a custom port`);
    console.log(`      ${terminalTextStyles.dim('>')} Use ${terminalTextStyles.bright('cloudcli --database-path /path/to/db')} for custom database`);
    console.log(`      ${terminalTextStyles.dim('>')} Run ${terminalTextStyles.bright('cloudcli help')} for all options`);
    console.log(`      ${terminalTextStyles.dim('>')} Access the UI at http://localhost:${process.env.SERVER_PORT || process.env.PORT || '3001'}\n`);
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
  start            Start the CloudCLI server (default)
  sandbox          Manage Docker sandbox environments
  browser-use-mcp  Run the Browser MCP stdio server
  status           Show configuration and data locations
  update           Update to the latest version
  help             Show this help information
  version          Show version information

Options:
  -p, --port <port>           Set server port (default: 3001)
  --database-path <path>      Set custom database location
  -h, --help                  Show this help information
  -v, --version               Show version information

Examples:
  $ cloudcli                        # Start with defaults
  $ cloudcli --port 8080            # Start on port 8080
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
            console.log(`\n${terminalTextStyles.warn('[UPDATE]')} New version available: ${terminalTextStyles.bright(latestVersion)} (current: ${currentVersion})`);
            console.log(`         Run ${terminalTextStyles.bright('cloudcli update')} to update\n`);
            return { hasUpdate: true, latestVersion, currentVersion };
        } else if (!silent) {
            console.log(`${terminalTextStyles.ok('[OK]')} You are on the latest version (${currentVersion})`);
        }
        return { hasUpdate: false, latestVersion, currentVersion };
    } catch (e) {
        if (!silent) {
            console.log(`${terminalTextStyles.warn('[WARN]')} Could not check for updates`);
        }
        return { hasUpdate: false, error: e.message };
    }
}

// Update the package
async function updatePackage() {
    try {
        const { execSync } = await import('child_process');
        console.log(`${terminalTextStyles.info('[INFO]')} Checking for updates...`);

        const { hasUpdate, latestVersion, currentVersion } = await checkForUpdates(true);

        if (!hasUpdate) {
            console.log(`${terminalTextStyles.ok('[OK]')} Already on the latest version (${currentVersion})`);
            return;
        }

        console.log(`${terminalTextStyles.info('[INFO]')} Updating from ${currentVersion} to ${latestVersion}...`);
        execSync('npm update -g @cloudcli-ai/cloudcli', { stdio: 'inherit' });
        console.log(`${terminalTextStyles.ok('[OK]')} Update complete! Restart cloudcli to use the new version.`);
    } catch (e) {
        console.error(`${terminalTextStyles.error('[ERROR]')} Update failed: ${e.message}`);
        console.log(`${terminalTextStyles.tip('[TIP]')} Try running manually: npm update -g @cloudcli-ai/cloudcli`);
    }
}

// ── Sandbox command ─────────────────────────────────────────

const SANDBOX_TEMPLATES = {
    claude: 'docker.io/cloudcliai/sandbox:claude-code',
    codex: 'docker.io/cloudcliai/sandbox:codex',
};

const SANDBOX_SECRETS = {
    claude: 'anthropic',
    codex: 'openai',
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
${terminalTextStyles.bright('CloudCLI Sandbox')} — Run CloudCLI inside Docker Sandboxes

Usage:
  cloudcli sandbox <workspace>            Create and start a sandbox
  cloudcli sandbox <subcommand> [name]    Manage sandboxes

Subcommands:
  ${terminalTextStyles.bright('(default)')}    Create a sandbox and start the web UI
  ${terminalTextStyles.bright('ls')}           List all sandboxes
  ${terminalTextStyles.bright('start')}        Restart a stopped sandbox and re-launch the web UI
  ${terminalTextStyles.bright('stop')}         Stop a sandbox (preserves state)
  ${terminalTextStyles.bright('rm')}           Remove a sandbox
  ${terminalTextStyles.bright('logs')}         Show CloudCLI server logs
  ${terminalTextStyles.bright('help')}         Show this help

Options:
  -a, --agent <agent>       Agent to use: claude, codex (default: claude)
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
        console.error(`\n${terminalTextStyles.error('❌')} Invalid sandbox name: ${opts.name}`);
        console.log(`   Names may only contain letters, numbers, hyphens, and underscores.\n`);
        process.exit(1);
    }

    // Check sbx is installed
    try {
        sbx(['version']);
    } catch {
        console.error(`\n${terminalTextStyles.error('❌')} ${terminalTextStyles.bright('sbx')} CLI not found.\n`);
        console.log(`   Install it from: ${terminalTextStyles.info('https://docs.docker.com/ai/sandboxes/get-started/')}`);
        console.log(`   Then run: ${terminalTextStyles.bright('sbx login')}`);
        console.log(`   And store your API key: ${terminalTextStyles.bright('sbx secret set -g anthropic')}\n`);
        process.exit(1);
    }

    switch (opts.subcommand) {

        case 'ls':
            sbx(['ls'], { inherit: true });
            break;

        case 'stop':
            if (!opts.name) {
                console.error(`\n${terminalTextStyles.error('❌')} Sandbox name required: cloudcli sandbox stop <name>\n`);
                process.exit(1);
            }
            sbx(['stop', opts.name], { inherit: true });
            break;

        case 'rm':
            if (!opts.name) {
                console.error(`\n${terminalTextStyles.error('❌')} Sandbox name required: cloudcli sandbox rm <name>\n`);
                process.exit(1);
            }
            sbx(['rm', opts.name], { inherit: true });
            break;

        case 'logs':
            if (!opts.name) {
                console.error(`\n${terminalTextStyles.error('❌')} Sandbox name required: cloudcli sandbox logs <name>\n`);
                process.exit(1);
            }
            try {
                sbx(['exec', opts.name, 'bash', '-c', 'cat /tmp/cloudcli-ui.log'], { inherit: true });
            } catch (e) {
                console.error(`\n${terminalTextStyles.error('❌')} Could not read logs: ${e.message || 'Is the sandbox running?'}\n`);
            }
            break;

        case 'start': {
            if (!opts.name) {
                console.error(`\n${terminalTextStyles.error('❌')} Sandbox name required: cloudcli sandbox start <name>\n`);
                process.exit(1);
            }
            console.log(`\n${terminalTextStyles.info('▶')} Starting sandbox ${terminalTextStyles.bright(opts.name)}...`);
            const restartRun = spawnProcess('sbx', ['run', opts.name], {
                detached: true,
                stdio: ['ignore', 'ignore', 'ignore'],
            });
            restartRun.unref();
            await new Promise(resolve => setTimeout(resolve, 5000));

            console.log(`${terminalTextStyles.info('▶')} Launching CloudCLI web server...`);
            sbx(['exec', opts.name, 'bash', '-c', 'nohup cloudcli start --port 3001 > /tmp/cloudcli-ui.log 2>&1 & disown']);

            console.log(`${terminalTextStyles.info('▶')} Forwarding port ${opts.port} → 3001...`);
            try {
                sbx(['ports', opts.name, '--publish', `${opts.port}:3001`]);
            } catch (e) {
                const msg = e.stdout || e.stderr || e.message || '';
                if (msg.includes('address already in use')) {
                    const altPort = opts.port + 1;
                    console.log(`${terminalTextStyles.warn('⚠')}  Port ${opts.port} in use, trying ${altPort}...`);
                    try {
                        sbx(['ports', opts.name, '--publish', `${altPort}:3001`]);
                        opts.port = altPort;
                    } catch {
                        console.error(`${terminalTextStyles.error('❌')} Ports ${opts.port} and ${altPort} both in use. Use --port to specify a free port.`);
                        process.exit(1);
                    }
                } else {
                    throw e;
                }
            }

            console.log(`\n${terminalTextStyles.ok('✔')} ${terminalTextStyles.bright('CloudCLI is ready!')}`);
            console.log(`  ${terminalTextStyles.info('→')} ${terminalTextStyles.bright(`http://localhost:${opts.port}`)}\n`);
            break;
        }

        case 'create': {
            if (!opts.workspace) {
                console.error(`\n${terminalTextStyles.error('❌')} Workspace path required: cloudcli sandbox <path>\n`);
                console.log(`   Example: ${terminalTextStyles.bright('cloudcli sandbox ~/my-project')}\n`);
                process.exit(1);
            }

            const workspace = opts.workspace.startsWith('~')
                ? opts.workspace.replace(/^~/, os.homedir())
                : path.resolve(opts.workspace);

            if (!fs.existsSync(workspace)) {
                console.error(`\n${terminalTextStyles.error('❌')} Workspace path not found: ${terminalTextStyles.dim(workspace)}\n`);
                process.exit(1);
            }

            const secret = SANDBOX_SECRETS[opts.agent] || 'anthropic';

            // Check if the required secret is stored
            try {
                const secretList = sbx(['secret', 'ls']);
                if (!secretList.includes(secret)) {
                    console.error(`\n${terminalTextStyles.error('❌')} No ${terminalTextStyles.bright(secret)} API key found.\n`);
                    console.log(`   Run: ${terminalTextStyles.bright(`sbx secret set -g ${secret}`)}\n`);
                    process.exit(1);
                }
            } catch { /* sbx secret ls not available, skip check */ }

            console.log(`\n${terminalTextStyles.bright('CloudCLI Sandbox')}`);
            console.log(terminalTextStyles.dim('─'.repeat(50)));
            console.log(`  Agent:     ${terminalTextStyles.info(opts.agent)} ${terminalTextStyles.dim(`(${secret} credentials)`)}`);
            console.log(`  Workspace: ${terminalTextStyles.dim(workspace)}`);
            console.log(`  Name:      ${terminalTextStyles.dim(opts.name)}`);
            console.log(`  Template:  ${terminalTextStyles.dim(opts.template)}`);
            console.log(`  Port:      ${terminalTextStyles.dim(String(opts.port))}`);
            if (opts.env.length > 0) {
                console.log(`  Env:       ${terminalTextStyles.dim(opts.env.join(', '))}`);
            }
            console.log(terminalTextStyles.dim('─'.repeat(50)));

            // Step 1: Launch sandbox with sbx run in background.
            // sbx run creates the sandbox (or reconnects) AND holds an active session,
            // which prevents the sandbox from auto-stopping.
            console.log(`\n${terminalTextStyles.info('▶')} Creating sandbox ${terminalTextStyles.bright(opts.name)}...`);
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
                console.log(`${terminalTextStyles.info('▶')} Setting environment variables...`);
                const exports = opts.env
                    .filter(e => /^\w+=.+$/.test(e))
                    .map(e => `export ${e}`)
                    .join('\n');
                if (exports) {
                    sbx(['exec', opts.name, 'bash', '-c', `echo '${exports}' >> /etc/sandbox-persistent.sh`]);
                }
                const invalid = opts.env.filter(e => !/^\w+=.+$/.test(e));
                if (invalid.length > 0) {
                    console.log(`${terminalTextStyles.warn('⚠')}  Skipped invalid env vars: ${invalid.join(', ')} (expected KEY=VALUE)`);
                }
            }

            // Step 3: Start CloudCLI inside the sandbox
            console.log(`${terminalTextStyles.info('▶')} Launching CloudCLI web server...`);
            sbx(['exec', opts.name, 'bash', '-c', 'nohup cloudcli start --port 3001 > /tmp/cloudcli-ui.log 2>&1 & disown']);

            // Step 4: Forward port
            console.log(`${terminalTextStyles.info('▶')} Forwarding port ${opts.port} → 3001...`);
            try {
                sbx(['ports', opts.name, '--publish', `${opts.port}:3001`]);
            } catch (e) {
                const msg = e.stdout || e.stderr || e.message || '';
                if (msg.includes('address already in use')) {
                    const altPort = opts.port + 1;
                    console.log(`${terminalTextStyles.warn('⚠')}  Port ${opts.port} in use, trying ${altPort}...`);
                    try {
                        sbx(['ports', opts.name, '--publish', `${altPort}:3001`]);
                        opts.port = altPort;
                    } catch {
                        console.error(`${terminalTextStyles.error('❌')} Ports ${opts.port} and ${altPort} both in use. Use --port to specify a free port.`);
                        process.exit(1);
                    }
                } else {
                    throw e;
                }
            }

            // Done
            console.log(`\n${terminalTextStyles.ok('✔')} ${terminalTextStyles.bright('CloudCLI is ready!')}`);
            console.log(`  ${terminalTextStyles.info('→')} Open ${terminalTextStyles.bright(`http://localhost:${opts.port}`)}`);
            console.log(`\n${terminalTextStyles.dim('  Manage with:')}`);
            console.log(`  ${terminalTextStyles.dim('$')} sbx ls`);
            console.log(`  ${terminalTextStyles.dim('$')} sbx stop ${opts.name}`);
            console.log(`  ${terminalTextStyles.dim('$')} sbx start ${opts.name}`);
            console.log(`  ${terminalTextStyles.dim('$')} sbx rm ${opts.name}`);
            console.log(`\n${terminalTextStyles.dim('  Or install globally:')} npm install -g @cloudcli-ai/cloudcli\n`);
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

async function startBrowserUseMcp() {
    await import('./browser-use-mcp.js');
}

// Parse CLI arguments
function parseArgs(args) {
    const parsed = { command: 'start', options: {} };

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
        } else if (arg === '--help' || arg === '-h') {
            parsed.command = 'help';
        } else if (arg === '--version' || arg === '-v') {
            parsed.command = 'version';
        } else if (!arg.startsWith('-')) {
            parsed.command = arg;
            if (arg === 'sandbox') {
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
    if (options.databasePath) {
        process.env.DATABASE_PATH = options.databasePath;
    }

    switch (command) {
        case 'start':
            await startServer();
            break;
        case 'sandbox':
            await sandboxCommand(remainingArgs || []);
            break;
        case 'browser-use-mcp':
            await startBrowserUseMcp();
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
            await updatePackage();
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
