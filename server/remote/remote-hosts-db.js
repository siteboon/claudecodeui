/**
 * Database CRUD operations for remote SSH host configurations
 * @module remote/remote-hosts-db
 */

import { db } from '../database/db.js';
import crypto from 'crypto';

/**
 * Create the remote_hosts table if it doesn't exist.
 * Called from runMigrations() in db.js.
 */
export function migrateRemoteHosts() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS remote_hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hostname TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        private_key_path TEXT NOT NULL,
        daemon_version TEXT,
        last_connected_at INTEGER,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch())
    )
  `);
  db.exec('CREATE INDEX IF NOT EXISTS idx_remote_hosts_name ON remote_hosts(name)');
}

export const remoteHostsDb = {
  /**
   * Create a new remote host configuration
   * @param {{ name: string, hostname: string, port?: number, username: string, privateKeyPath: string }} params
   * @returns {object} The created host record
   */
  create({ name, hostname, port = 22, username, privateKeyPath }) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO remote_hosts (id, name, hostname, port, username, private_key_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, hostname, port, username, privateKeyPath);
    return remoteHostsDb.getById(id);
  },

  /**
   * Get all remote host configurations, ordered by name
   * @returns {object[]}
   */
  getAll() {
    return db.prepare('SELECT * FROM remote_hosts ORDER BY name').all();
  },

  /**
   * Get a single remote host by ID
   * @param {string} id
   * @returns {object|undefined}
   */
  getById(id) {
    return db.prepare('SELECT * FROM remote_hosts WHERE id = ?').get(id);
  },

  /**
   * Update an existing remote host configuration
   * @param {string} id
   * @param {{ name: string, hostname: string, port?: number, username: string, privateKeyPath: string }} params
   * @returns {object} The updated host record
   */
  update(id, { name, hostname, port = 22, username, privateKeyPath }) {
    db.prepare(`
      UPDATE remote_hosts
      SET name = ?, hostname = ?, port = ?, username = ?, private_key_path = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(name, hostname, port, username, privateKeyPath, id);
    return remoteHostsDb.getById(id);
  },

  /**
   * Delete a remote host configuration
   * @param {string} id
   * @returns {boolean} True if a row was deleted
   */
  delete(id) {
    const result = db.prepare('DELETE FROM remote_hosts WHERE id = ?').run(id);
    return result.changes > 0;
  },

  /**
   * Update daemon version and last connected timestamp for a host
   * @param {string} id
   * @param {string} version
   */
  updateDaemonVersion(id, version) {
    db.prepare(`
      UPDATE remote_hosts
      SET daemon_version = ?, last_connected_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ?
    `).run(version, id);
  },
};
