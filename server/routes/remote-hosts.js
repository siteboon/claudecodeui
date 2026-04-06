/**
 * Express router for remote SSH host CRUD and connectivity testing
 * @module routes/remote-hosts
 */

import express from 'express';
import { Client } from 'ssh2';
import { readFile } from 'fs/promises';
import { remoteHostsDb } from '../remote/remote-hosts-db.js';
import { SSH_READY_TIMEOUT_MS } from '../constants/remote.js';

const router = express.Router();

/**
 * Convert a DB row (snake_case) to a camelCase API shape.
 * @param {object|null} row
 * @returns {object|null}
 */
function serializeHost(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    port: row.port,
    username: row.username,
    privateKeyPath: row.private_key_path,
    daemonVersion: row.daemon_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastConnectedAt: row.last_connected_at,
  };
}

/**
 * Validate host fields from request body.
 * @returns {{ valid: boolean, error?: string }}
 */
function validateHostFields({ name, hostname, username, privateKeyPath, port }) {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return { valid: false, error: 'name is required (string, non-empty)' };
  }
  if (name.trim().length > 100) {
    return { valid: false, error: 'name must be 100 characters or fewer' };
  }
  if (!hostname || typeof hostname !== 'string' || hostname.trim().length === 0) {
    return { valid: false, error: 'hostname is required (string, non-empty)' };
  }
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return { valid: false, error: 'username is required (string, non-empty)' };
  }
  if (!privateKeyPath || typeof privateKeyPath !== 'string' || privateKeyPath.trim().length === 0) {
    return { valid: false, error: 'privateKeyPath is required (string, non-empty)' };
  }
  if (port !== undefined && port !== null) {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      return { valid: false, error: 'port must be an integer between 1 and 65535' };
    }
  }
  return { valid: true };
}

/**
 * Test SSH connectivity using the provided config.
 * Returns a promise resolving to { success, error? }.
 */
function testSshConnectivity({ hostname, port, username, privateKey }) {
  return new Promise((resolve) => {
    const client = new Client();
    const timeout = setTimeout(() => {
      client.destroy();
      resolve({ success: false, error: 'Connection timed out' });
    }, SSH_READY_TIMEOUT_MS);

    client.once('ready', () => {
      clearTimeout(timeout);
      client.end();
      resolve({ success: true });
    });

    client.once('error', (err) => {
      clearTimeout(timeout);
      client.destroy();
      resolve({ success: false, error: err.message });
    });

    client.connect({
      host: hostname,
      port: port || 22,
      username,
      privateKey,
      readyTimeout: SSH_READY_TIMEOUT_MS,
    });
  });
}

// POST / — Create a new remote host
router.post('/', (req, res) => {
  try {
    const { name, hostname, port, username, privateKeyPath } = req.body;
    const validation = validateHostFields({ name, hostname, username, privateKeyPath, port });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const host = remoteHostsDb.create({
      name: name.trim(),
      hostname: hostname.trim(),
      port: port ? Number(port) : 22,
      username: username.trim(),
      privateKeyPath: privateKeyPath.trim(),
    });
    return res.status(201).json(serializeHost(host));
  } catch (err) {
    console.error('Failed to create remote host:', err);
    return res.status(500).json({ error: 'Failed to create remote host' });
  }
});

// GET /connections — Get connection states for all remote hosts
router.get('/connections', async (req, res) => {
  try {
    const { getAllConnections } = await import('../remote/connection-manager.js');
    const connections = getAllConnections();
    const result = [];
    for (const [hostId, mgr] of connections) {
      result.push({ hostId, state: mgr.state });
    }
    return res.json(result);
  } catch {
    return res.json([]);
  }
});

// GET / — List all remote hosts
router.get('/', (req, res) => {
  try {
    const hosts = remoteHostsDb.getAll();
    return res.json(hosts.map(serializeHost));
  } catch (err) {
    console.error('Failed to list remote hosts:', err);
    return res.status(500).json({ error: 'Failed to list remote hosts' });
  }
});

// GET /:id — Get a single remote host
router.get('/:id', (req, res) => {
  try {
    const host = remoteHostsDb.getById(req.params.id);
    if (!host) {
      return res.status(404).json({ error: 'Remote host not found' });
    }
    return res.json(serializeHost(host));
  } catch (err) {
    console.error('Failed to get remote host:', err);
    return res.status(500).json({ error: 'Failed to get remote host' });
  }
});

// PUT /:id — Update a remote host
router.put('/:id', (req, res) => {
  try {
    const existing = remoteHostsDb.getById(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Remote host not found' });
    }
    const { name, hostname, port, username, privateKeyPath } = req.body;
    const validation = validateHostFields({ name, hostname, username, privateKeyPath, port });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
    const updated = remoteHostsDb.update(req.params.id, {
      name: name.trim(),
      hostname: hostname.trim(),
      port: port ? Number(port) : 22,
      username: username.trim(),
      privateKeyPath: privateKeyPath.trim(),
    });
    return res.json(serializeHost(updated));
  } catch (err) {
    console.error('Failed to update remote host:', err);
    return res.status(500).json({ error: 'Failed to update remote host' });
  }
});

// DELETE /:id — Delete a remote host
router.delete('/:id', (req, res) => {
  try {
    const deleted = remoteHostsDb.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Remote host not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete remote host:', err);
    return res.status(500).json({ error: 'Failed to delete remote host' });
  }
});

// POST /test — Test SSH connectivity (pre-save, config in body)
router.post('/test', async (req, res) => {
  try {
    const { hostname, port, username, privateKeyPath } = req.body;
    if (!hostname || !username || !privateKeyPath) {
      return res.status(400).json({ error: 'hostname, username, and privateKeyPath are required' });
    }

    let privateKey;
    try {
      privateKey = await readFile(privateKeyPath);
    } catch (err) {
      return res.json({ success: false, error: `Cannot read key file: ${err.message}` });
    }

    const result = await testSshConnectivity({
      hostname,
      port: port || 22,
      username,
      privateKey,
    });
    return res.json(result);
  } catch (err) {
    console.error('Failed to test SSH connectivity:', err);
    return res.status(500).json({ error: 'Failed to test SSH connectivity' });
  }
});

// POST /:id/test — Test SSH connectivity for a saved host
router.post('/:id/test', async (req, res) => {
  try {
    const host = remoteHostsDb.getById(req.params.id);
    if (!host) {
      return res.status(404).json({ error: 'Remote host not found' });
    }

    let privateKey;
    try {
      privateKey = await readFile(host.private_key_path);
    } catch (err) {
      return res.json({ success: false, error: `Cannot read key file: ${err.message}` });
    }

    const result = await testSshConnectivity({
      hostname: host.hostname,
      port: host.port,
      username: host.username,
      privateKey,
    });
    return res.json(result);
  } catch (err) {
    console.error('Failed to test SSH connectivity:', err);
    return res.status(500).json({ error: 'Failed to test SSH connectivity' });
  }
});

export default router;
