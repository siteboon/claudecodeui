import express from 'express';
import path from 'path';
import http from 'http';
import mime from 'mime-types';
import fs from 'fs';
import {
  scanPlugins,
  getPluginsConfig,
  getPluginsDir,
  savePluginsConfig,
  getPluginDir,
  resolvePluginAssetPath,
  installPluginFromGit,
  updatePluginFromGit,
  uninstallPlugin,
} from '../utils/plugin-loader.js';
import {
  startPluginServer,
  stopPluginServer,
  getPluginPort,
  isPluginRunning,
} from '../utils/plugin-process-manager.js';

const router = express.Router();

// GET / — List all installed plugins (includes server running status)
router.get('/', (req, res) => {
  try {
    const plugins = scanPlugins().map(p => ({
      ...p,
      serverRunning: p.server ? isPluginRunning(p.name) : false,
    }));
    res.json({ plugins });
  } catch (err) {
    res.status(500).json({ error: 'Failed to scan plugins', details: err.message });
  }
});

// GET /:name/manifest — Get single plugin manifest
router.get('/:name/manifest', (req, res) => {
  try {
    if (!/^[a-zA-Z0-9_-]+$/.test(req.params.name)) {
      return res.status(400).json({ error: 'Invalid plugin name' });
    }
    const plugins = scanPlugins();
    const plugin = plugins.find(p => p.name === req.params.name);
    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }
    res.json(plugin);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read plugin manifest', details: err.message });
  }
});

// GET /:name/assets/* — Serve plugin static files
router.get('/:name/assets/*', (req, res) => {
  const pluginName = req.params.name;
  if (!/^[a-zA-Z0-9_-]+$/.test(pluginName)) {
    return res.status(400).json({ error: 'Invalid plugin name' });
  }
  const assetPath = req.params[0];

  if (!assetPath) {
    return res.status(400).json({ error: 'No asset path specified' });
  }

  const resolvedPath = resolvePluginAssetPath(pluginName, assetPath);
  if (!resolvedPath) {
    return res.status(404).json({ error: 'Asset not found' });
  }

  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return res.status(404).json({ error: 'Asset not found' });
    }
  } catch {
    return res.status(404).json({ error: 'Asset not found' });
  }

  const contentType = mime.lookup(resolvedPath) || 'application/octet-stream';
  res.setHeader('Content-Type', contentType);
  const stream = fs.createReadStream(resolvedPath);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read asset' });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
});

// PUT /:name/enable — Toggle plugin enabled/disabled (starts/stops server if applicable)
router.put('/:name/enable', async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: '"enabled" must be a boolean' });
    }

    const plugins = scanPlugins();
    const plugin = plugins.find(p => p.name === req.params.name);
    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }

    const config = getPluginsConfig();
    config[req.params.name] = { ...config[req.params.name], enabled };
    savePluginsConfig(config);

    // Start or stop the plugin server as needed
    if (plugin.server) {
      if (enabled && !isPluginRunning(plugin.name)) {
        const pluginDir = getPluginDir(plugin.name);
        if (pluginDir) {
          try {
            await startPluginServer(plugin.name, pluginDir, plugin.server);
          } catch (err) {
            console.error(`[Plugins] Failed to start server for "${plugin.name}":`, err.message);
          }
        }
      } else if (!enabled && isPluginRunning(plugin.name)) {
        await stopPluginServer(plugin.name);
      }
    }

    res.json({ success: true, name: req.params.name, enabled });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plugin', details: err.message });
  }
});

// POST /install — Install plugin from git URL
router.post('/install', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: '"url" is required and must be a string' });
    }

    // Basic URL validation
    if (!url.startsWith('https://') && !url.startsWith('git@')) {
      return res.status(400).json({ error: 'URL must start with https:// or git@' });
    }

    const manifest = await installPluginFromGit(url);

    // Auto-start the server if the plugin has one (enabled by default)
    if (manifest.server) {
      const pluginDir = getPluginDir(manifest.name);
      if (pluginDir) {
        try {
          await startPluginServer(manifest.name, pluginDir, manifest.server);
        } catch (err) {
          console.error(`[Plugins] Failed to start server for "${manifest.name}":`, err.message);
        }
      }
    }

    res.json({ success: true, plugin: manifest });
  } catch (err) {
    res.status(400).json({ error: 'Failed to install plugin', details: err.message });
  }
});

// POST /:name/update — Pull latest from git (restarts server if running)
router.post('/:name/update', async (req, res) => {
  try {
    const pluginName = req.params.name;

    if (!/^[a-zA-Z0-9_-]+$/.test(pluginName)) {
      return res.status(400).json({ error: 'Invalid plugin name' });
    }

    const wasRunning = isPluginRunning(pluginName);
    if (wasRunning) {
      await stopPluginServer(pluginName);
    }

    const manifest = await updatePluginFromGit(pluginName);

    // Restart server if it was running before the update
    if (wasRunning && manifest.server) {
      const pluginDir = getPluginDir(pluginName);
      if (pluginDir) {
        try {
          await startPluginServer(pluginName, pluginDir, manifest.server);
        } catch (err) {
          console.error(`[Plugins] Failed to restart server for "${pluginName}":`, err.message);
        }
      }
    }

    res.json({ success: true, plugin: manifest });
  } catch (err) {
    res.status(400).json({ error: 'Failed to update plugin', details: err.message });
  }
});

// ALL /:name/rpc/* — Proxy requests to plugin's server subprocess
router.all('/:name/rpc/*', async (req, res) => {
  const pluginName = req.params.name;
  const rpcPath = req.params[0] || '';

  if (!/^[a-zA-Z0-9_-]+$/.test(pluginName)) {
    return res.status(400).json({ error: 'Invalid plugin name' });
  }

  let port = getPluginPort(pluginName);
  if (!port) {
    // Lazily start the plugin server if it exists and is enabled
    const plugins = scanPlugins();
    const plugin = plugins.find(p => p.name === pluginName);
    if (!plugin || !plugin.server) {
      return res.status(503).json({ error: 'Plugin server is not running' });
    }
    if (!plugin.enabled) {
      return res.status(503).json({ error: 'Plugin is disabled' });
    }
    const pluginDir = path.join(getPluginsDir(), plugin.dirName);
    try {
      port = await startPluginServer(pluginName, pluginDir, plugin.server);
    } catch (err) {
      return res.status(503).json({ error: 'Plugin server failed to start', details: err.message });
    }
  }

  // Inject configured secrets as headers
  const config = getPluginsConfig();
  const pluginConfig = config[pluginName] || {};
  const secrets = pluginConfig.secrets || {};

  const headers = {
    'content-type': req.headers['content-type'] || 'application/json',
  };

  // Add per-plugin secrets as X-Plugin-Secret-* headers
  for (const [key, value] of Object.entries(secrets)) {
    headers[`x-plugin-secret-${key.toLowerCase()}`] = String(value);
  }

  // Reconstruct query string
  const qs = req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '';

  const options = {
    hostname: '127.0.0.1',
    port,
    path: `/${rpcPath}${qs}`,
    method: req.method,
    headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Plugin server error', details: err.message });
    } else {
      res.end();
    }
  });

  // Forward body (already parsed by express JSON middleware, so re-stringify).
  // Check content-length to detect whether a body was actually sent, since
  // req.body can be falsy for valid payloads like 0, false, null, or {}.
  const hasBody = req.headers['content-length'] && parseInt(req.headers['content-length'], 10) > 0;
  if (hasBody && req.body !== undefined) {
    const bodyStr = JSON.stringify(req.body);
    proxyReq.setHeader('content-length', Buffer.byteLength(bodyStr));
    proxyReq.write(bodyStr);
  }

  proxyReq.end();
});

// DELETE /:name — Uninstall plugin (stops server first)
router.delete('/:name', async (req, res) => {
  try {
    const pluginName = req.params.name;

    // Validate name format to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(pluginName)) {
      return res.status(400).json({ error: 'Invalid plugin name' });
    }

    // Stop server and wait for the process to fully exit before deleting files
    if (isPluginRunning(pluginName)) {
      await stopPluginServer(pluginName);
    }

    await uninstallPlugin(pluginName);
    res.json({ success: true, name: pluginName });
  } catch (err) {
    res.status(400).json({ error: 'Failed to uninstall plugin', details: err.message });
  }
});

export default router;
