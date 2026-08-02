/**
 * Machines repository.
 *
 * Persists control-plane machine records used by the multi-worker gateway.
 * Tokens are stored as SHA-256 hashes; the plaintext token is only returned at
 * creation time by the machines service.
 */

import crypto from 'node:crypto';

import { getConnection } from '@/modules/database/connection.js';

export type MachineStatus = 'online' | 'offline';

export type MachineRow = {
  id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  status: MachineStatus;
  last_seen_at: string | null;
  hostname: string | null;
  created_at: string;
  revoked_at: string | null;
};

export type PublicMachineRecord = {
  id: string;
  name: string;
  tokenPrefix: string;
  status: MachineStatus;
  lastSeenAt: string | null;
  hostname: string | null;
  createdAt: string;
  revokedAt: string | null;
};

function mapMachineRow(row: MachineRow): PublicMachineRecord {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    status: row.status,
    lastSeenAt: row.last_seen_at,
    hostname: row.hostname,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

/** Hashes a machine token for durable storage and lookup. */
export function hashMachineToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Generates a cryptographically random machine worker token with the `mw_` prefix. */
export function generateMachineToken(): string {
  return `mw_${crypto.randomBytes(32).toString('hex')}`;
}

export const machinesDb = {
  hashMachineToken,
  generateMachineToken,

  /** Inserts a machine row. Callers must pass an already-hashed token. */
  createMachine(input: {
    id: string;
    name: string;
    tokenHash: string;
    tokenPrefix: string;
  }): PublicMachineRecord {
    const db = getConnection();
    db.prepare(
      `INSERT INTO machines (id, name, token_hash, token_prefix, status)
       VALUES (?, ?, ?, ?, 'offline')`,
    ).run(input.id, input.name, input.tokenHash, input.tokenPrefix);

    const row = db
      .prepare('SELECT * FROM machines WHERE id = ?')
      .get(input.id) as MachineRow;
    return mapMachineRow(row);
  },

  /** Lists non-revoked machines, newest first. */
  listMachines(): PublicMachineRecord[] {
    const db = getConnection();
    const rows = db
      .prepare(
        `SELECT * FROM machines
         WHERE revoked_at IS NULL
         ORDER BY created_at DESC`,
      )
      .all() as MachineRow[];
    return rows.map(mapMachineRow);
  },

  /** Returns one machine by id, including revoked rows. */
  getMachineById(machineId: string): PublicMachineRecord | null {
    const db = getConnection();
    const row = db
      .prepare('SELECT * FROM machines WHERE id = ?')
      .get(machineId) as MachineRow | undefined;
    return row ? mapMachineRow(row) : null;
  },

  /**
   * Resolves an active machine from a plaintext token.
   * Returns null when the token is unknown or the machine was revoked.
   */
  findActiveMachineByToken(token: string): PublicMachineRecord | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT * FROM machines
         WHERE token_hash = ? AND revoked_at IS NULL`,
      )
      .get(hashMachineToken(token)) as MachineRow | undefined;
    return row ? mapMachineRow(row) : null;
  },

  /** Renames a non-revoked machine. Returns null when missing/revoked. */
  renameMachine(machineId: string, name: string): PublicMachineRecord | null {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE machines
         SET name = ?
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(name, machineId);
    if (result.changes === 0) {
      return null;
    }
    return machinesDb.getMachineById(machineId);
  },

  /** Soft-revokes a machine so its token can no longer authenticate. */
  revokeMachine(machineId: string): boolean {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE machines
         SET revoked_at = CURRENT_TIMESTAMP, status = 'offline'
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(machineId);
    return result.changes > 0;
  },

  /** Marks a machine online and refreshes last-seen metadata. */
  markOnline(machineId: string, hostname?: string | null): PublicMachineRecord | null {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE machines
         SET status = 'online',
             last_seen_at = CURRENT_TIMESTAMP,
             hostname = COALESCE(?, hostname)
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(hostname ?? null, machineId);
    if (result.changes === 0) {
      return null;
    }
    return machinesDb.getMachineById(machineId);
  },

  /** Marks a machine offline. */
  markOffline(machineId: string): PublicMachineRecord | null {
    const db = getConnection();
    const result = db
      .prepare(
        `UPDATE machines
         SET status = 'offline', last_seen_at = CURRENT_TIMESTAMP
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(machineId);
    if (result.changes === 0) {
      return null;
    }
    return machinesDb.getMachineById(machineId);
  },

  /** Touches last_seen_at for an online machine heartbeat. */
  touchHeartbeat(machineId: string): void {
    const db = getConnection();
    db.prepare(
      `UPDATE machines
       SET last_seen_at = CURRENT_TIMESTAMP
       WHERE id = ? AND revoked_at IS NULL`,
    ).run(machineId);
  },
};
