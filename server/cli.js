#!/usr/bin/env node
/**
 * Claude Code UI CLI
 *
 * Provides command-line utilities for managing Claude Code UI
 *
 * Commands:
 *   (no args)     - Start the server (default)
 *   start         - Start the server
 *   status        - Show configuration and data locations
 *   help          - Show help information
 *   version       - Show version information
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// Load environment variables from .env file if it exists
function loadEnvFile() {
    try {
        const envPath = path.join(__dirname, '../.env');
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
    return process.env.DATABASE_PATH || path.join(__dirname, 'database', 'auth.db');
}

// Get the installation directory
function getInstallDir() {
    return path.join(__dirname, '..');
}

// Show status command
function showStatus() {
    console.log(`\n${c.bright('Claude Code UI - Status')}\n`);
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
    console.log(`       PORT: ${c.bright(process.env.PORT || '3001')} ${c.dim(process.env.PORT ? '' : '(default)')}`);
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
    const envFilePath = path.join(__dirname, '../.env');
    const envExists = fs.existsSync(envFilePath);
    console.log(`\n${c.info('[INFO]')} Configuration File:`);
    console.log(`       ${c.dim(envFilePath)}`);
    console.log(`       Status: ${envExists ? c.ok('[OK] Exists') : c.warn('[WARN] Not found (using defaults)')}`);

    console.log('\n' + c.dim('═'.repeat(60)));
    console.log(`\n${c.tip('[TIP]')} Hints:`);
    console.log(`      ${c.dim('>')} Use ${c.bright('cloudcli --port 8080')} to run on a custom port`);
    console.log(`      ${c.dim('>')} Use ${c.bright('cloudcli --database-path /path/to/db')} for custom database`);
    console.log(`      ${c.dim('>')} Run ${c.bright('cloudcli help')} for all options`);
    console.log(`      ${c.dim('>')} Access the UI at http://localhost:${process.env.PORT || '3001'}\n`);
}

// Show help
function showHelp() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              Claude Code UI - Command Line Tool               ║
╚═══════════════════════════════════════════════════════════════╝

Usage:
  claude-code-ui [command] [options]
  cloudcli [command] [options]

Commands:
  start          Start the Claude Code UI server (default)
  status         Show configuration and data locations
  update         Update to the latest version
  help           Show this help information
  version        Show version information

Options:
  -p, --port <port>           Set server port (default: 3001)
  --database-path <path>      Set custom database location
  -h, --help                  Show this help information
  -v, --version               Show version information

Examples:
  $ cloudcli                        # Start with defaults
  $ cloudcli --port 8080            # Start on port 8080
  $ cloudcli -p 3000                # Short form for port
  $ cloudcli start --port 4000      # Explicit start command
  $ cloudcli status                 # Show configuration

Environment Variables:
  PORT                Set server port (default: 3001)
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
        const latestVersion = execSync('npm show @siteboon/claude-code-ui version', { encoding: 'utf8' }).trim();
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
async function updatePackage() {
    try {
        const { execSync } = await import('child_process');
        console.log(`${c.info('[INFO]')} Checking for updates...`);

        const { hasUpdate, latestVersion, currentVersion } = await checkForUpdates(true);

        if (!hasUpdate) {
            console.log(`${c.ok('[OK]')} Already on the latest version (${currentVersion})`);
            return;
        }

        console.log(`${c.info('[INFO]')} Updating from ${currentVersion} to ${latestVersion}...`);
        execSync('npm update -g @siteboon/claude-code-ui', { stdio: 'inherit' });
        console.log(`${c.ok('[OK]')} Update complete! Restart cloudcli to use the new version.`);
    } catch (e) {
        console.error(`${c.error('[ERROR]')} Update failed: ${e.message}`);
        console.log(`${c.tip('[TIP]')} Try running manually: npm update -g @siteboon/claude-code-ui`);
    }
}

// Start the server
async function startServer() {
    // Check for updates silently on startup
    checkForUpdates(true);

    // Import and run the server
    await import('./index.js');
}

// Parse CLI arguments
function parseArgs(args) {
    const parsed = { command: 'start', options: {} };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--port' || arg === '-p') {
            parsed.options.port = args[++i];
        } else if (arg.startsWith('--port=')) {
            parsed.options.port = arg.split('=')[1];
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
        }
    }

    return parsed;
}

// Main CLI handler
async function main() {
    const args = process.argv.slice(2);
    const { command, options } = parseArgs(args);

    // Apply CLI options to environment variables
    if (options.port) {
        process.env.PORT = options.port;
    }
    if (options.databasePath) {
        process.env.DATABASE_PATH = options.databasePath;
    }

    switch (command) {
        case 'start':
            await startServer();
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
