// @ts-nocheck -- the registry's dynamic manifest schema is narrowed by Plugins service adapters.
import fs from 'fs';
import path from 'path';
import os from 'os';

import { spawn } from 'cross-spawn';

import { AppError } from '@/shared/utils.js';

const PLUGINS_DIR = path.join(os.homedir(), '.claude-code-ui', 'plugins');
const PLUGINS_CONFIG_PATH = path.join(os.homedir(), '.claude-code-ui', 'plugins.json');

const REQUIRED_MANIFEST_FIELDS = ['name', 'displayName', 'entry'];

/** Strip embedded credentials from a repo URL before exposing it to the client. */
function sanitizeRepoUrl(raw) {
  try {
    const u = new URL(raw);
    u.username = '';
    u.password = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    // Not a parseable URL (e.g. SSH shorthand) — strip user:pass@ segment
    return raw.replace(/\/\/[^@/]+@/, '//');
  }
}
const ALLOWED_TYPES = ['react', 'module'];
const ALLOWED_SLOTS = ['tab'];

export function getPluginsDir() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }
  return PLUGINS_DIR;
}

export function getPluginsConfig() {
  try {
    if (fs.existsSync(PLUGINS_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(PLUGINS_CONFIG_PATH, 'utf-8'));
    }
  } catch {
    // Corrupted config, start fresh
  }
  return {};
}

export function savePluginsConfig(config) {
  const dir = path.dirname(PLUGINS_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(PLUGINS_CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, error: 'Manifest must be a JSON object' };
  }

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      return { valid: false, error: `Missing or invalid required field: ${field}` };
    }
  }

  // Sanitize name — only allow alphanumeric, hyphens, underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(manifest.name)) {
    return { valid: false, error: 'Plugin name must only contain letters, numbers, hyphens, and underscores' };
  }

  if (manifest.type && !ALLOWED_TYPES.includes(manifest.type)) {
    return { valid: false, error: `Invalid plugin type: ${manifest.type}. Must be one of: ${ALLOWED_TYPES.join(', ')}` };
  }

  if (manifest.slot && !ALLOWED_SLOTS.includes(manifest.slot)) {
    return { valid: false, error: `Invalid plugin slot: ${manifest.slot}. Must be one of: ${ALLOWED_SLOTS.join(', ')}` };
  }

  // Validate entry is a relative path without traversal
  if (manifest.entry.includes('..') || path.isAbsolute(manifest.entry)) {
    return { valid: false, error: 'Entry must be a relative path without ".."' };
  }

  if (manifest.server !== undefined && manifest.server !== null) {
    if (typeof manifest.server !== 'string' || manifest.server.includes('..') || path.isAbsolute(manifest.server)) {
      return { valid: false, error: 'Server entry must be a relative path string without ".."' };
    }
  }

  if (manifest.permissions !== undefined) {
    if (!Array.isArray(manifest.permissions) || !manifest.permissions.every(p => typeof p === 'string')) {
      return { valid: false, error: 'Permissions must be an array of strings' };
    }
  }

  return { valid: true };
}

const BUILD_TIMEOUT_MS = 60_000;

/** Run `npm run build` if the plugin's package.json declares a build script. */
function runBuildIfNeeded(dir, packageJsonPath, onSuccess, onError) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    if (!pkg.scripts?.build) {
      return onSuccess();
    }
  } catch {
    return onSuccess(); // Unreadable package.json — skip build
  }

  const buildProcess = spawn('npm', ['run', 'build'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    buildProcess.removeAllListeners();
    buildProcess.kill();
    onError(new Error('npm run build timed out'));
  }, BUILD_TIMEOUT_MS);

  buildProcess.stderr.on('data', (data) => { stderr += data.toString(); });

  buildProcess.on('close', (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (code !== 0) {
      return onError(new Error(`npm run build failed (exit code ${code}): ${stderr.trim()}`));
    }
    onSuccess();
  });

  buildProcess.on('error', (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    onError(new Error(`Failed to spawn build: ${err.message}`));
  });
}

export function scanPlugins() {
  const pluginsDir = getPluginsDir();
  const config = getPluginsConfig();
  const plugins = [];

  let entries;
  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return plugins;
  }

  const seenNames = new Set();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip transient temp directories from in-progress installs
    if (entry.name.startsWith('.tmp-')) continue;

    const manifestPath = path.join(pluginsDir, entry.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const validation = validateManifest(manifest);
      if (!validation.valid) {
        console.warn(`[Plugins] Skipping ${entry.name}: ${validation.error}`);
        continue;
      }

      // Skip duplicate manifest names
      if (seenNames.has(manifest.name)) {
        console.warn(`[Plugins] Skipping ${entry.name}: duplicate plugin name "${manifest.name}"`);
        continue;
      }
      seenNames.add(manifest.name);

      // Try to read git remote URL
      let repoUrl = null;
      try {
        const gitConfigPath = path.join(pluginsDir, entry.name, '.git', 'config');
        if (fs.existsSync(gitConfigPath)) {
          const gitConfig = fs.readFileSync(gitConfigPath, 'utf-8');
          const match = gitConfig.match(/url\s*=\s*(.+)/);
          if (match) {
            repoUrl = match[1].trim().replace(/\.git$/, '');
            // Convert SSH URLs to HTTPS
            if (repoUrl.startsWith('git@')) {
              repoUrl = repoUrl.replace(/^git@([^:]+):/, 'https://$1/');
            }
            // Strip embedded credentials (e.g. https://user:pass@host/...)
            repoUrl = sanitizeRepoUrl(repoUrl);
          }
        }
      } catch { /* ignore */ }

      plugins.push({
        name: manifest.name,
        displayName: manifest.displayName,
        version: manifest.version || '0.0.0',
        description: manifest.description || '',
        author: manifest.author || '',
        icon: manifest.icon || 'Puzzle',
        type: manifest.type || 'module',
        slot: manifest.slot || 'tab',
        entry: manifest.entry,
        server: manifest.server || null,
        permissions: manifest.permissions || [],
        enabled: config[manifest.name]?.enabled !== false, // enabled by default
        dirName: entry.name,
        repoUrl,
      });
    } catch (err) {
      console.warn(`[Plugins] Failed to read manifest for ${entry.name}:`, err.message);
    }
  }

  return plugins;
}

export function getPluginDir(name) {
  const plugins = scanPlugins();
  const plugin = plugins.find(p => p.name === name);
  if (!plugin) return null;
  return path.join(getPluginsDir(), plugin.dirName);
}

export function resolvePluginAssetPath(name, assetPath) {
  const pluginDir = getPluginDir(name);
  if (!pluginDir) return null;

  const resolved = path.resolve(pluginDir, assetPath);

  // Prevent path traversal — canonicalize via realpath to defeat symlink bypasses
  if (!fs.existsSync(resolved)) return null;

  const realResolved = fs.realpathSync(resolved);
  const realPluginDir = fs.realpathSync(pluginDir);
  if (!realResolved.startsWith(realPluginDir + path.sep) && realResolved !== realPluginDir) {
    return null;
  }

  return realResolved;
}

/**
 * Environment for the plugin `git clone` / `git pull`. Git runs with the server
 * user's own setup, so credential helpers, ~/.git-credentials, GIT_ASKPASS and
 * SSH keys keep working. It must never ask for a username or password on the
 * terminal, though: when the server was started from a shell, the prompt lands
 * in that shell and the install request hangs until someone answers it there.
 */
function buildPluginGitEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_TERMINAL_PROMPT: '0' };
}

type PluginGitFailureKind = 'auth' | 'not-found' | 'unreachable';

// Checked in order against git's stderr. Most hosts (GitHub included) answer an
// anonymous request for a private repository and for a missing one with the
// same 401, so an auth failure can only ever mean "private or missing"; only a
// host that knows who is asking can say "not found".
const PLUGIN_GIT_FAILURE_PATTERNS: Array<[PluginGitFailureKind, RegExp]> = [
  ['auth', /could not read (username|password)|authentication failed|invalid username or (password|token)|http basic: access denied|permission denied \(publickey|host key verification failed|requested url returned error: 40[13]\b/i],
  ['not-found', /repository not found|repository '[^']*' not found|does not appear to be a git repository|requested url returned error: 404\b|could not be found or you don't have permission/i],
  ['unreachable', /could not resolve host|failed to connect to|connection refused|connection timed out|operation timed out|network is unreachable|no route to host|connection reset/i],
];

const PLUGIN_GIT_FAILURES: Record<PluginGitFailureKind, { code: string; statusCode: number; reason: string }> = {
  auth: {
    code: 'PLUGIN_GIT_AUTH_REQUIRED',
    statusCode: 422,
    reason: 'git could not authenticate to the repository\'s host, so the repository is private or does not exist. '
      + 'Plugins are installed and updated with the git credentials of the user the CloudCLI server runs as: '
      + 'set up a credential helper for that user (for example `gh auth setup-git` or ~/.git-credentials), '
      + 'or an SSH key and known_hosts entry for git@ URLs, then try again.',
  },
  'not-found': {
    code: 'PLUGIN_GIT_REPO_NOT_FOUND',
    statusCode: 422,
    reason: 'the repository was not found. Check the URL; if the repository is private, the git credentials '
      + 'of the user the CloudCLI server runs as have no access to it.',
  },
  unreachable: {
    code: 'PLUGIN_GIT_HOST_UNREACHABLE',
    statusCode: 502,
    reason: 'the git host could not be reached. Check the URL and the server\'s network connection.',
  },
};

/** Removes `user:password@` from any URL git echoed, before the text is logged or sent to the client. */
function redactUrlCredentials(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1');
}

/**
 * Turns a failed plugin `git clone` / `git pull` into an AppError the Settings >
 * Plugins screen can show: a stable code and an actionable message for the
 * common failures (credentials missing, repository missing, host unreachable),
 * and git's own last error line for anything else. The full git output stays in
 * `details` and in the server log.
 *
 * Exported for tests.
 */
export function createPluginGitError(
  action: 'install' | 'update',
  gitCommand: 'clone' | 'pull',
  exitCode: number | null,
  stderr: string,
): AppError {
  const gitOutput = redactUrlCredentials(stderr).replace(/\r/g, '').trim();
  console.error(`[Plugins] git ${gitCommand} failed (exit code ${exitCode}):\n${gitOutput}`);

  const details = { gitCommand: `git ${gitCommand}`, exitCode, gitOutput: gitOutput.slice(-4000) };
  const kind = PLUGIN_GIT_FAILURE_PATTERNS.find(([, pattern]) => pattern.test(gitOutput))?.[0];
  if (kind) {
    const { code, statusCode, reason } = PLUGIN_GIT_FAILURES[kind];
    return new AppError(`Could not ${action} the plugin: ${reason}`, { code, statusCode, details });
  }

  // Unrecognised: git's last fatal/error line is the most useful thing to show.
  const lines = gitOutput.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('Cloning into'));
  const lastError = [...lines].reverse().find((line) => /^(fatal|error):/i.test(line)) ?? lines.at(-1);
  const summary = lastError ? lastError.replace(/^(fatal|error):\s*/i, '') : `exit code ${exitCode}`;
  return new AppError(`Could not ${action} the plugin: git ${gitCommand} failed: ${summary}`, {
    code: 'PLUGIN_GIT_FAILED',
    statusCode: 502,
    details,
  });
}

export function installPluginFromGit(url) {
  return new Promise((resolve, reject) => {
    if (typeof url !== 'string' || !url.trim()) {
      return reject(new Error('Invalid URL: must be a non-empty string'));
    }
    if (url.startsWith('-')) {
      return reject(new Error('Invalid URL: must not start with "-"'));
    }

    // Extract repo name from URL for directory name
    const urlClean = url.replace(/\.git$/, '').replace(/\/$/, '');
    const repoName = urlClean.split('/').pop();

    if (!repoName || !/^[a-zA-Z0-9_.-]+$/.test(repoName)) {
      return reject(new Error('Could not determine a valid directory name from the URL'));
    }

    const pluginsDir = getPluginsDir();
    const targetDir = path.resolve(pluginsDir, repoName);

    // Ensure the resolved target directory stays within the plugins directory
    if (!targetDir.startsWith(pluginsDir + path.sep)) {
      return reject(new Error('Invalid plugin directory path'));
    }

    if (fs.existsSync(targetDir)) {
      return reject(new Error(`Plugin directory "${repoName}" already exists`));
    }

    // Clone into a temp directory so scanPlugins() never sees a partially-installed plugin
    const tempDir = fs.mkdtempSync(path.join(pluginsDir, `.tmp-${repoName}-`));

    const cleanupTemp = () => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    };

    const finalize = (manifest) => {
      try {
        fs.renameSync(tempDir, targetDir);
      } catch (err) {
        cleanupTemp();
        return reject(new Error(`Failed to move plugin into place: ${err.message}`));
      }
      resolve(manifest);
    };

    const gitProcess = spawn('git', ['clone', '--depth', '1', '--', url, tempDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildPluginGitEnvironment(),
    });

    let stderr = '';
    gitProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    gitProcess.on('close', (code) => {
      if (code !== 0) {
        cleanupTemp();
        return reject(createPluginGitError('install', 'clone', code, stderr));
      }

      // Validate manifest exists
      const manifestPath = path.join(tempDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        cleanupTemp();
        return reject(new Error('Cloned repository does not contain a manifest.json'));
      }

      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        cleanupTemp();
        return reject(new Error('manifest.json is not valid JSON'));
      }

      const validation = validateManifest(manifest);
      if (!validation.valid) {
        cleanupTemp();
        return reject(new Error(`Invalid manifest: ${validation.error}`));
      }

      // Reject if another installed plugin already uses this name
      const existing = scanPlugins().find(p => p.name === manifest.name);
      if (existing) {
        cleanupTemp();
        return reject(new Error(`A plugin named "${manifest.name}" is already installed (in "${existing.dirName}")`));
      }

      // Run npm install if package.json exists.
      // --ignore-scripts prevents postinstall hooks from executing arbitrary code.
      const packageJsonPath = path.join(tempDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const npmProcess = spawn('npm', ['install', '--ignore-scripts'], {
          cwd: tempDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        npmProcess.on('close', (npmCode) => {
          if (npmCode !== 0) {
            cleanupTemp();
            return reject(new Error(`npm install for ${repoName} failed (exit code ${npmCode})`));
          }
          runBuildIfNeeded(tempDir, packageJsonPath, () => finalize(manifest), (err) => { cleanupTemp(); reject(err); });
        });

        npmProcess.on('error', (err) => {
          cleanupTemp();
          reject(err);
        });
      } else {
        finalize(manifest);
      }
    });

    gitProcess.on('error', (err) => {
      cleanupTemp();
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });
  });
}

export function updatePluginFromGit(name) {
  return new Promise((resolve, reject) => {
    const pluginDir = getPluginDir(name);
    if (!pluginDir) {
      return reject(new Error(`Plugin "${name}" not found`));
    }

    // Only fast-forward to avoid silent divergence
    const gitProcess = spawn('git', ['pull', '--ff-only', '--'], {
      cwd: pluginDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildPluginGitEnvironment(),
    });

    let stderr = '';
    gitProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    gitProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(createPluginGitError('update', 'pull', code, stderr));
      }

      // Re-validate manifest after update
      const manifestPath = path.join(pluginDir, 'manifest.json');
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch {
        return reject(new Error('manifest.json is not valid JSON after update'));
      }

      const validation = validateManifest(manifest);
      if (!validation.valid) {
        return reject(new Error(`Invalid manifest after update: ${validation.error}`));
      }

      // Re-run npm install if package.json exists
      const packageJsonPath = path.join(pluginDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const npmProcess = spawn('npm', ['install', '--ignore-scripts'], {
          cwd: pluginDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        npmProcess.on('close', (npmCode) => {
          if (npmCode !== 0) {
            return reject(new Error(`npm install for ${name} failed (exit code ${npmCode})`));
          }
          runBuildIfNeeded(pluginDir, packageJsonPath, () => resolve(manifest), (err) => reject(err));
        });
        npmProcess.on('error', (err) => reject(err));
      } else {
        resolve(manifest);
      }
    });

    gitProcess.on('error', (err) => {
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });
  });
}

export async function uninstallPlugin(name) {
  const pluginDir = getPluginDir(name);
  if (!pluginDir) {
    throw new Error(`Plugin "${name}" not found`);
  }

  // On Windows, file handles may be released slightly after process exit.
  // Retry a few times with a short delay before giving up.
  const MAX_RETRIES = 5;
  const RETRY_DELAY_MS = 500;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fs.rmSync(pluginDir, { recursive: true, force: true });
      break;
    } catch (err) {
      if (err.code === 'EBUSY' && attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }

  // Remove from config
  const config = getPluginsConfig();
  delete config[name];
  savePluginsConfig(config);
}
