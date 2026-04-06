/** @module routes/remote-connections */

import express from 'express';
import path from 'path';
import { createConnection, getConnection, removeConnection } from '../remote/connection-manager.js';
import { remoteHostsDb } from '../remote/remote-hosts-db.js';
import { loadProjectConfig, saveProjectConfig } from '../projects.js';

/**
 * Create the remote-connections router.
 * Lifecycle hooks (state broadcast, reconnection) are now handled globally
 * via setOnConnectionCreated() in connection-manager.js.
 * @returns {express.Router}
 */
export default function createRemoteConnectionRoutes() {
  const router = express.Router();

  // POST /:id/connect — Establish persistent SSH connection
  router.post('/:id/connect', (req, res) => {
    try {
      const host = remoteHostsDb.getById(req.params.id);
      if (!host) {
        return res.status(404).json({ error: 'Remote host not found' });
      }

      // Check if connection already exists
      const existing = getConnection(req.params.id);
      if (existing) {
        if (existing.state === 'ready') {
          return res.status(200).json({ state: 'ready', message: 'Already connected' });
        }
        if (existing.state === 'connecting' || existing.state === 'deploying' || existing.state === 'initializing') {
          return res.status(200).json({ state: existing.state, message: 'Connection in progress' });
        }
      }

      // Create connection and start lifecycle (fire-and-forget)
      // Lifecycle listeners are attached globally via setOnConnectionCreated()
      const mgr = createConnection(host);

      mgr.connect().catch((err) => {
        console.error('[remote-connections] Connect error:', err.message);
      });

      return res.status(202).json({ state: mgr.state, hostId: host.id, message: 'Connection initiated' });
    } catch (err) {
      console.error('[remote-connections] POST /:id/connect error:', err);
      return res.status(500).json({ error: 'Failed to initiate connection' });
    }
  });

  // POST /:id/disconnect — Cleanly disconnect
  router.post('/:id/disconnect', (req, res) => {
    try {
      const host = remoteHostsDb.getById(req.params.id);
      if (!host) {
        return res.status(404).json({ error: 'Remote host not found' });
      }

      const existing = getConnection(req.params.id);
      if (!existing) {
        return res.status(200).json({ state: 'disconnected', message: 'Not connected' });
      }

      removeConnection(req.params.id);
      return res.status(200).json({ state: 'disconnected', message: 'Disconnected' });
    } catch (err) {
      console.error('[remote-connections] POST /:id/disconnect error:', err);
      return res.status(500).json({ error: 'Failed to disconnect' });
    }
  });

  // GET /:id/status — Get current connection state
  router.get('/:id/status', (req, res) => {
    try {
      const host = remoteHostsDb.getById(req.params.id);
      if (!host) {
        return res.status(404).json({ error: 'Remote host not found' });
      }

      const mgr = getConnection(req.params.id);
      if (!mgr) {
        return res.status(200).json({ state: 'disconnected', connected: false });
      }

      return res.status(200).json({
        state: mgr.state,
        connected: mgr.isReady,
        hostId: req.params.id,
        hostName: host.name,
      });
    } catch (err) {
      console.error('[remote-connections] GET /:id/status error:', err);
      return res.status(500).json({ error: 'Failed to get connection status' });
    }
  });

  // GET /:id/browse — Browse remote filesystem for directory picker
  router.get('/:id/browse', async (req, res) => {
    try {
      const host = remoteHostsDb.getById(req.params.id);
      if (!host) {
        return res.status(404).json({ error: 'Remote host not found' });
      }

      const mgr = getConnection(req.params.id);
      if (!mgr || !mgr.isReady) {
        return res.status(409).json({ error: 'Host is not connected' });
      }

      const dirPath = req.query.path || '/';

      const result = await mgr.transport.request('fs/readdir', { path: dirPath, maxDepth: 1 });

      // Filter to directories only
      const entries = Array.isArray(result)
        ? result.filter((entry) => entry.type === 'directory')
        : [];

      return res.status(200).json({
        path: dirPath,
        entries: entries.map((entry) => ({
          name: entry.name,
          path: entry.path,
          type: entry.type,
        })),
      });
    } catch (err) {
      console.error('[remote-connections] GET /:id/browse error:', err);
      return res.status(500).json({ error: 'Failed to browse remote filesystem', details: err.message });
    }
  });

  // POST /:id/add-project — Register a remote project
  router.post('/:id/add-project', async (req, res) => {
    try {
      const host = remoteHostsDb.getById(req.params.id);
      if (!host) {
        return res.status(404).json({ error: 'Remote host not found' });
      }

      const mgr = getConnection(req.params.id);
      if (!mgr || !mgr.isReady) {
        return res.status(409).json({ error: 'Host is not connected' });
      }

      const { remotePath } = req.body || {};
      if (!remotePath || typeof remotePath !== 'string') {
        return res.status(400).json({ error: 'remotePath is required and must be a non-empty string' });
      }

      const normalizedRemotePath = path.posix.normalize(remotePath.trim()).replace(/\/+$/, '') || '/';
      if (!normalizedRemotePath) {
        return res.status(400).json({ error: 'remotePath is required and must be a non-empty string' });
      }
      if (!normalizedRemotePath.startsWith('/')) {
        return res.status(400).json({ error: 'remotePath must be an absolute directory path' });
      }

      let remoteStats;
      try {
        remoteStats = await mgr.transport.request('fs/stat', { path: normalizedRemotePath }, 15000);
      } catch (err) {
        if (err.code === -32001) {
          return res.status(404).json({ error: 'Remote path not found' });
        }
        if (err.code === -32002) {
          return res.status(403).json({ error: 'Permission denied for remote path' });
        }
        throw err;
      }

      if (remoteStats.type !== 'directory') {
        return res.status(400).json({ error: 'remotePath must point to a directory' });
      }

      const projectName = `remote:${req.params.id}:${Buffer.from(normalizedRemotePath).toString('base64')}`;
      const displayName = normalizedRemotePath.split('/').filter(Boolean).pop() || normalizedRemotePath;

      const config = await loadProjectConfig();

      // Return existing if already registered
      if (config[projectName]) {
        return res.status(200).json({
          success: true,
          project: { name: projectName, displayName, remotePath: normalizedRemotePath, hostId: req.params.id },
          existing: true,
        });
      }

      config[projectName] = {
        manuallyAdded: true,
        originalPath: normalizedRemotePath,
        isRemote: true,
        hostId: req.params.id,
      };

      if (displayName) {
        config[projectName].displayName = displayName;
      }

      await saveProjectConfig(config);

      return res.status(201).json({
        success: true,
        project: { name: projectName, displayName, remotePath: normalizedRemotePath, hostId: req.params.id },
      });
    } catch (err) {
      console.error('[remote-connections] POST /:id/add-project error:', err);
      return res.status(500).json({ error: 'Failed to add remote project', details: err.message });
    }
  });

  return router;
}
