import { spawn } from 'child_process';
import path from 'path';
import { scanPlugins, getPluginsConfig, getPluginDir } from './plugin-loader.js';

// Map<pluginName, { process, port }>
const runningPlugins = new Map();
// Map<pluginName, Promise<port>> — in-flight start operations
const startingPlugins = new Map();

/**
 * Start a plugin's server subprocess.
 * The plugin's server entry must print a JSON line with { ready: true, port: <number> }
 * to stdout within 10 seconds.
 */
export function startPluginServer(name, pluginDir, serverEntry) {
  if (runningPlugins.has(name)) {
    return Promise.resolve(runningPlugins.get(name).port);
  }

  // Coalesce concurrent starts for the same plugin
  if (startingPlugins.has(name)) {
    return startingPlugins.get(name);
  }

  const startPromise = new Promise((resolve, reject) => {

    const serverPath = path.join(pluginDir, serverEntry);

    // Restricted env — only essentials, no host secrets
    const pluginProcess = spawn('node', [serverPath], {
      cwd: pluginDir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: process.env.NODE_ENV || 'production',
        PLUGIN_NAME: name,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let resolved = false;
    let stdout = '';

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        pluginProcess.kill();
        reject(new Error('Plugin server did not report ready within 10 seconds'));
      }
    }, 10000);

    pluginProcess.stdout.on('data', (data) => {
      if (resolved) return;
      stdout += data.toString();

      // Look for the JSON ready line
      const lines = stdout.split('\n');
      for (const line of lines) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.ready && typeof msg.port === 'number') {
            clearTimeout(timeout);
            resolved = true;
            runningPlugins.set(name, { process: pluginProcess, port: msg.port });

            pluginProcess.on('exit', () => {
              runningPlugins.delete(name);
            });

            console.log(`[Plugins] Server started for "${name}" on port ${msg.port}`);
            resolve(msg.port);
          }
        } catch {
          // Not JSON yet, keep buffering
        }
      }
    });

    pluginProcess.stderr.on('data', (data) => {
      console.warn(`[Plugin:${name}] ${data.toString().trim()}`);
    });

    pluginProcess.on('error', (err) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Failed to start plugin server: ${err.message}`));
      }
    });

    pluginProcess.on('exit', (code) => {
      clearTimeout(timeout);
      runningPlugins.delete(name);
      if (!resolved) {
        resolved = true;
        reject(new Error(`Plugin server exited with code ${code} before reporting ready`));
      }
    });
  }).finally(() => {
    startingPlugins.delete(name);
  });

  startingPlugins.set(name, startPromise);
  return startPromise;
}

/**
 * Stop a plugin's server subprocess.
 * Returns a Promise that resolves when the process has fully exited.
 */
export function stopPluginServer(name) {
  const entry = runningPlugins.get(name);
  if (!entry) return Promise.resolve();

  return new Promise((resolve) => {
    const cleanup = () => {
      clearTimeout(forceKillTimer);
      runningPlugins.delete(name);
      resolve();
    };

    entry.process.once('exit', cleanup);

    entry.process.kill('SIGTERM');

    // Force kill after 5 seconds if still running
    const forceKillTimer = setTimeout(() => {
      if (runningPlugins.has(name)) {
        entry.process.kill('SIGKILL');
        cleanup();
      }
    }, 5000);

    console.log(`[Plugins] Server stopped for "${name}"`);
  });
}

/**
 * Get the port a running plugin server is listening on.
 */
export function getPluginPort(name) {
  return runningPlugins.get(name)?.port ?? null;
}

/**
 * Check if a plugin's server is running.
 */
export function isPluginRunning(name) {
  return runningPlugins.has(name);
}

/**
 * Stop all running plugin servers (called on host shutdown).
 */
export function stopAllPlugins() {
  const stops = [];
  for (const [name] of runningPlugins) {
    stops.push(stopPluginServer(name));
  }
  return Promise.all(stops);
}

/**
 * Start servers for all enabled plugins that have a server entry.
 * Called once on host server boot.
 */
export async function startEnabledPluginServers() {
  const plugins = scanPlugins();
  const config = getPluginsConfig();

  for (const plugin of plugins) {
    if (!plugin.server) continue;
    if (config[plugin.name]?.enabled === false) continue;

    const pluginDir = getPluginDir(plugin.name);
    if (!pluginDir) continue;

    try {
      await startPluginServer(plugin.name, pluginDir, plugin.server);
    } catch (err) {
      console.error(`[Plugins] Failed to start server for "${plugin.name}":`, err.message);
    }
  }
}
