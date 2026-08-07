// @ts-nocheck -- the registry's dynamic manifest schema is narrowed by Plugins service adapters.
import fs from 'fs';
import path from 'path';
import os from 'os';

import { spawn } from 'cross-spawn';

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

/**
 * Whether `npm run build` should execute after `npm install` for newly cloned
 * plugins. Plugin build scripts run with the host Node process's privileges,
 * so they are a remote code execution vector for any party who can supply a
 * malicious plugin URL. The default is OFF: only the install/update caller's
 * explicit opt-in (via the {@link PluginInstallOptions.allowBuild} flag) will
 * permit build scripts to run.
 */
let ALLOW_PLUGIN_BUILD_SCRIPT = false;

/** Process-wide override used by tests and callers that have vetted the plugin. */
export function setAllowPluginBuildScript(allowed) {
  ALLOW_PLUGIN_BUILD_SCRIPT = allowed === true;
}

/** Run `npm run build` if the plugin's package.json declares a build script. */
function runBuildIfNeeded(dir, packageJsonPath, options, onSuccess, onError) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  } catch {
    return onSuccess(); // Unreadable package.json — skip build
  }

  if (!pkg.scripts?.build) {
    return onSuccess();
  }

  if (!ALLOW_PLUGIN_BUILD_SCRIPT && !options?.allowBuild) {
    return onError(new Error(
      'Plugin declares a "build" script but plugin builds are disabled by default. ' +
      'Plugin build scripts run arbitrary code with the server process privileges. ' +
      'To install this plugin, ship a pre-built artifact and remove the build script, ' +
      'or set `allowBuild: true` after manually inspecting the build script.',
    ));
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

export function installPluginFromGit(url, options) {
  return new Promise((resolve, reject) => {
    if (typeof url !== 'string' || !url.trim()) {
      return reject(new Error('Invalid URL: must be a non-empty string'));
    }
    if (url.startsWith('-')) {
      return reject(new Error('Invalid URL: must not start with "-"'));
    }
    // Only allow the supported remote transports. The HTTP layer in
    // plugins.service.ts already enforces this for incoming requests, but
    // validating here too prevents any internal caller (tests, future
    // programmatic install paths) from bypassing the scheme check.
    if (!url.startsWith('https://') && !url.startsWith('git@')) {
      return reject(new Error('Invalid URL: only https:// and git@ remotes are supported'));
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
    });

    let stderr = '';
    gitProcess.stderr.on('data', (data) => { stderr += data.toString(); });

    gitProcess.on('close', (code) => {
      if (code !== 0) {
        cleanupTemp();
        return reject(new Error(`git clone failed (exit code ${code}): ${stderr.trim()}`));
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
          runBuildIfNeeded(tempDir, packageJsonPath, options, () => finalize(manifest), (err) => { cleanupTemp(); reject(err); });
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

export function updatePluginFromGit(name, options) {
  return new Promise((resolve, reject) => {
    const pluginDir = getPluginDir(name);
    if (!pluginDir) {
      return reject(new Error(`Plugin "${name}" not found`));
    }

    const pluginsDir = getPluginsDir();
    // Clone the updated tree into a sibling temp directory and only swap it
    // into place after every side-effectful step (manifest validation,
    // npm install, optional build policy) has succeeded. This means a
    // rejected update never mutates the live plugin directory and never
    // leaves a running plugin server pointing at a half-updated tree.
    const tempDir = fs.mkdtempSync(path.join(pluginsDir, `.tmp-update-${name}-`));

    const cleanupTemp = () => {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    };

    const finalize = (manifest) => {
      // Replace the live directory with the validated temp dir while keeping
      // the previous tree in a sibling backup. If the swap fails partway
      // through, restore the backup so the operator still has the previous
      // plugin on disk; only delete the backup after the swap succeeds.
      const backupDir = fs.existsSync(pluginDir)
        ? `${pluginDir}.previous-${process.pid}-${Date.now()}`
        : null;
      try {
        if (backupDir) {
          fs.renameSync(pluginDir, backupDir);
        }
        fs.renameSync(tempDir, pluginDir);
      } catch (err) {
        // Roll back: remove the partially-installed temp dir (if the second
        // rename succeeded we have nothing to restore) and put the backup
        // back in place of the live directory (if one existed).
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        if (backupDir && fs.existsSync(backupDir) && !fs.existsSync(pluginDir)) {
          try { fs.renameSync(backupDir, pluginDir); } catch {}
        }
        return reject(new Error(`Failed to move updated plugin into place: ${err.message}`));
      }

      if (backupDir) {
        try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch {}
      }
      resolve(manifest);
    };

    // Clone the live plugin's current remote URL into the temp dir. We
    // intentionally re-clone (rather than `git pull` against the live
    // directory) so a failure or a rejected build leaves the live tree
    // untouched.
    const configPath = path.join(pluginDir, '.git', 'config');
    let remoteUrl = null;
    try {
      const gitConfig = fs.readFileSync(configPath, 'utf-8');
      const match = gitConfig.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/);
      if (match) remoteUrl = match[1].trim();
    } catch (err) {
      cleanupTemp();
      return reject(new Error(`Failed to read git remote for "${name}": ${err.message}`));
    }
    if (!remoteUrl) {
      cleanupTemp();
      return reject(new Error(`Plugin "${name}" has no git remote URL`));
    }

    const cloneProcess = spawn('git', ['clone', '--depth', '1', '--', remoteUrl, tempDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let cloneStderr = '';
    cloneProcess.stderr.on('data', (data) => { cloneStderr += data.toString(); });

    cloneProcess.on('close', (code) => {
      if (code !== 0) {
        cleanupTemp();
        return reject(new Error(`git clone failed (exit code ${code}): ${cloneStderr.trim()}`));
      }

      // Validate manifest exists and is well-formed before any further work.
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
        return reject(new Error('manifest.json is not valid JSON after update'));
      }

      const validation = validateManifest(manifest);
      if (!validation.valid) {
        cleanupTemp();
        return reject(new Error(`Invalid manifest after update: ${validation.error}`));
      }

      // Re-run npm install if package.json exists.
      const packageJsonPath = path.join(tempDir, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const npmProcess = spawn('npm', ['install', '--ignore-scripts'], {
          cwd: tempDir,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        npmProcess.on('close', (npmCode) => {
          if (npmCode !== 0) {
            cleanupTemp();
            return reject(new Error(`npm install for ${name} failed (exit code ${npmCode})`));
          }
          // Build-policy rejection leaves the live plugin directory untouched
          // because we have not swapped `tempDir` into place yet.
          runBuildIfNeeded(tempDir, packageJsonPath, options, () => finalize(manifest), (err) => { cleanupTemp(); reject(err); });
        });

        npmProcess.on('error', (err) => {
          cleanupTemp();
          reject(err);
        });
      } else {
        finalize(manifest);
      }
    });

    cloneProcess.on('error', (err) => {
      cleanupTemp();
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
