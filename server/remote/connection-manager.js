/** @module remote/connection-manager */

import { EventEmitter } from 'events';
import { Client } from 'ssh2';
import { readFile } from 'fs/promises';
import { SSHTransport } from './transport.js';
import { deployDaemon } from './deployer.js';
import { remoteHostsDb } from './remote-hosts-db.js';
import {
  CONNECTION_STATES,
  MAX_RECONNECT_ATTEMPTS,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  JITTER_MS,
  SSH_KEEPALIVE_INTERVAL_MS,
  SSH_KEEPALIVE_COUNT_MAX,
  SSH_READY_TIMEOUT_MS,
  DAEMON_READY_TIMEOUT_MS,
  DAEMON_REMOTE_PATH,
  DAEMON_PID_PATH,
  PROTOCOL_VERSION,
} from '../constants/remote.js';

/**
 * Calculate exponential backoff delay with jitter.
 * @param {number} attempt - Zero-based attempt index
 * @returns {number} Delay in milliseconds
 */
function calculateBackoff(attempt) {
  const exponential = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
  const jitter = Math.random() * JITTER_MS;
  return exponential + jitter;
}

/**
 * Run a command on a remote host via ssh2 client.exec().
 * NOTE: This uses ssh2's Client.exec() API which runs commands on the
 * REMOTE host over SSH. This is NOT Node.js child_process.
 * @param {object} client - ssh2 Client instance
 * @param {string} command - Command to run on the remote host
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function sshRunCommand(client, command) {
  return new Promise((resolve, reject) => {
    client.exec(command, { env: { TERM: 'dumb' } }, (err, channel) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      channel.on('data', (d) => { stdout += d.toString(); });
      channel.stderr.on('data', (d) => { stderr += d.toString(); });
      channel.on('close', (code) => resolve({ stdout, stderr, code }));
    });
  });
}

/** @type {Map<string, SSHConnectionManager>} */
const activeConnections = new Map();

/**
 * SSH connection lifecycle manager with state machine, deployment, and reconnection.
 *
 * State transitions: disconnected -> connecting -> deploying -> initializing -> ready
 * On error: reconnecting (with exponential backoff) -> connecting -> ...
 * After MAX_RECONNECT_ATTEMPTS: failed (permanent)
 */
export class SSHConnectionManager extends EventEmitter {
  /**
   * @param {object} hostConfig
   * @param {string} hostConfig.id
   * @param {string} hostConfig.hostname
   * @param {number} [hostConfig.port]
   * @param {string} hostConfig.username
   * @param {string} [hostConfig.privateKeyPath]
   * @param {string} [hostConfig.private_key_path]
   * @param {string} hostConfig.name
   */
  constructor(hostConfig) {
    super();
    this._hostConfig = hostConfig;
    this._state = CONNECTION_STATES.DISCONNECTED;
    this._client = null;
    this._transport = null;
    this._reconnectAttempt = 0;
    this._reconnectTimer = null;
    this._intentionalDisconnect = false;
  }

  /**
   * Raw ssh2 Client for creating shell/sftp channels.
   * Shell channels are independent from the daemon's exec channel --
   * SSH multiplexes multiple channels over one connection.
   * @returns {object|null} ssh2 Client instance, or null if not connected
   */
  get client() {
    return this._client || null;
  }

  /** @returns {string} Current connection state */
  get state() {
    return this._state;
  }

  /** @returns {SSHTransport|null} Active transport for JSON-RPC requests */
  get transport() {
    return this._transport;
  }

  /** @returns {string} Host ID */
  get hostId() {
    return this._hostConfig.id;
  }

  /** @returns {boolean} Whether the connection is in READY state */
  get isReady() {
    return this._state === CONNECTION_STATES.READY;
  }

  /**
   * Transition to a new state and emit a state event.
   * @param {string} newState
   * @param {string|null} [detail]
   */
  _setState(newState, detail = null) {
    const oldState = this._state;
    this._state = newState;
    this.emit('state', { state: newState, previousState: oldState, detail });
    console.log(
      '[ConnectionManager:' + this._hostConfig.name + '] ' +
      oldState + ' -> ' + newState +
      (detail ? ' (' + detail + ')' : '')
    );
  }

  /**
   * Start a new connection attempt. No-op if already connecting.
   * Resets the reconnect counter and kicks off _doConnect().
   */
  async connect() {
    if (
      this._state === CONNECTION_STATES.CONNECTING ||
      this._state === CONNECTION_STATES.DEPLOYING ||
      this._state === CONNECTION_STATES.INITIALIZING
    ) {
      return;
    }
    this._intentionalDisconnect = false;
    this._reconnectAttempt = 0;
    await this._doConnect();
  }

  /**
   * Core connection lifecycle: SSH connect -> deploy daemon -> initialize handshake -> ready.
   */
  async _doConnect() {
    // 1. CONNECTING: Read SSH key
    this._setState(CONNECTION_STATES.CONNECTING);

    let privateKey;
    try {
      const keyPath = this._hostConfig.privateKeyPath || this._hostConfig.private_key_path;
      privateKey = await readFile(keyPath);
    } catch (err) {
      const detail = err.code === 'ENOENT'
        ? 'SSH key file not found: ' + (this._hostConfig.privateKeyPath || this._hostConfig.private_key_path)
        : err.code === 'EACCES'
          ? 'Permission denied reading SSH key'
          : 'Failed to read SSH key: ' + err.message;
      this._setState(CONNECTION_STATES.ERROR, detail);
      return;
    }

    // 2. Create SSH client and attach error handler BEFORE connect
    this._client = new Client();
    this._client.on('error', (err) => this._handleSSHError(err));

    // 3. Await SSH ready
    try {
      await new Promise((resolve, reject) => {
        this._client.once('ready', resolve);
        this._client.once('error', reject);
        this._client.connect({
          host: this._hostConfig.hostname,
          port: this._hostConfig.port || 22,
          username: this._hostConfig.username,
          privateKey,
          keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
          keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
          readyTimeout: SSH_READY_TIMEOUT_MS,
        });
      });
    } catch (err) {
      this._handleConnectionFailure(err.message);
      return;
    }

    // 4. SSH ready -- replace one-time listeners with persistent ones
    this._client.removeAllListeners('error');
    this._client.on('error', (err) => this._handleSSHError(err));
    this._client.on('close', () => this._handleSSHClose());
    this._client.on('end', () => this._handleSSHClose());

    try {
      // 5. DEPLOYING: Kill existing daemon, deploy new one
      this._setState(CONNECTION_STATES.DEPLOYING);

      // Pre-connect cleanup: kill any existing daemon via PID file
      try {
        await sshRunCommand(
          this._client,
          'kill $(cat ~/' + DAEMON_PID_PATH + ' 2>/dev/null) 2>/dev/null; rm -f ~/' + DAEMON_PID_PATH
        );
      } catch {
        // No existing daemon is fine
      }

      const deployResult = await deployDaemon(this._client);
      if (deployResult.deployed) {
        try {
          remoteHostsDb.updateDaemonVersion(this._hostConfig.id, deployResult.version);
        } catch (dbErr) {
          console.error('[ConnectionManager] Failed to update daemon version in DB:', dbErr.message);
        }
      }

      // 6. INITIALIZING: Launch daemon and handshake
      this._setState(CONNECTION_STATES.INITIALIZING);

      let channel = await new Promise((resolve, reject) => {
        this._client.exec('bash -l -c "node ~/' + DAEMON_REMOTE_PATH + '"', { env: { TERM: 'dumb' } }, (err, ch) => {
          if (err) return reject(err);
          resolve(ch);
        });
      });

      this._transport = new SSHTransport(channel);

      let initResult = await this._transport.request(
        'initialize',
        { protocolVersion: PROTOCOL_VERSION, clientVersion: '1.0.0' },
        DAEMON_READY_TIMEOUT_MS
      );

      // 7. Protocol version check -- re-deploy if mismatched
      if (initResult.protocolVersion !== PROTOCOL_VERSION) {
        console.log('[ConnectionManager] Protocol mismatch, re-deploying daemon...');
        this._transport.close();
        this._transport = null;

        await deployDaemon(this._client, { force: true });

        channel = await new Promise((resolve, reject) => {
          this._client.exec('bash -l -c "node ~/' + DAEMON_REMOTE_PATH + '"', { env: { TERM: 'dumb' } }, (err, ch) => {
            if (err) return reject(err);
            resolve(ch);
          });
        });

        this._transport = new SSHTransport(channel);

        initResult = await this._transport.request(
          'initialize',
          { protocolVersion: PROTOCOL_VERSION, clientVersion: '1.0.0' },
          DAEMON_READY_TIMEOUT_MS
        );

        if (initResult.protocolVersion !== PROTOCOL_VERSION) {
          this._setState(CONNECTION_STATES.ERROR, 'Protocol version mismatch after re-deploy');
          return;
        }
      }

      // 8. READY — detect reconnection before resetting counter
      const wasReconnection = this._reconnectAttempt > 0;
      this._reconnectAttempt = 0;
      this._setState(CONNECTION_STATES.READY);

      if (wasReconnection) {
        this.emit('reconnected', { hostId: this._hostConfig.id });
      }
    } catch (err) {
      this._handleConnectionFailure(err.message);
    }
  }

  /**
   * Cleanly disconnect from the remote host.
   */
  disconnect() {
    this._intentionalDisconnect = true;

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._transport) {
      this._transport.close();
      this._transport = null;
    }

    if (this._client) {
      try {
        this._client.end();
      } catch {
        // Client may already be closed
      }
      this._client = null;
    }

    this._setState(CONNECTION_STATES.DISCONNECTED);
  }

  /**
   * Handle SSH error events.
   * @param {Error} err
   */
  _handleSSHError(err) {
    console.error('[ConnectionManager:' + this._hostConfig.name + '] SSH error:', err.message);
    if (this._intentionalDisconnect) return;
    this._attemptReconnect(err.message);
  }

  /**
   * Handle SSH close/end events.
   */
  _handleSSHClose() {
    if (this._intentionalDisconnect || this._state === CONNECTION_STATES.DISCONNECTED) return;

    if (this._transport) {
      this._transport.close();
      this._transport = null;
    }

    this._attemptReconnect('SSH connection closed');
  }

  /**
   * Handle a connection failure during the connect lifecycle.
   * @param {string} reason
   */
  _handleConnectionFailure(reason) {
    if (this._transport) {
      this._transport.close();
      this._transport = null;
    }

    if (this._client) {
      try {
        this._client.destroy();
      } catch {
        // Ignore
      }
      this._client = null;
    }

    this._attemptReconnect(reason);
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * @param {string} reason
   */
  _attemptReconnect(reason) {
    // Guard: if a reconnect is already scheduled, don't double-schedule
    if (this._reconnectTimer) return;

    this._reconnectAttempt++;

    if (this._reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
      this._setState(CONNECTION_STATES.FAILED, 'Max reconnect attempts exceeded: ' + reason);
      return;
    }

    this._setState(
      CONNECTION_STATES.RECONNECTING,
      'Attempt ' + this._reconnectAttempt + '/' + MAX_RECONNECT_ATTEMPTS + ': ' + reason
    );

    const delay = calculateBackoff(this._reconnectAttempt - 1);
    console.log(
      '[ConnectionManager:' + this._hostConfig.name + '] Reconnecting in ' +
      Math.round(delay) + 'ms (attempt ' + this._reconnectAttempt + ')'
    );

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._doConnect().catch((err) => {
        this._handleConnectionFailure(err.message);
      });
    }, delay);
  }

  /**
   * Disconnect and remove all event listeners.
   */
  destroy() {
    this.disconnect();
    this.removeAllListeners();
  }
}

/**
 * Global hook invoked whenever a connection is created (from createConnection or ensureConnection).
 * Set via setOnConnectionCreated(). Used by the server to attach WebSocket broadcast listeners.
 * @type {((mgr: SSHConnectionManager, hostId: string) => void) | null}
 */
let globalOnConnectionCreated = null;

/**
 * Register a global callback for new connections.
 * @param {(mgr: SSHConnectionManager, hostId: string) => void} callback
 */
export function setOnConnectionCreated(callback) {
  globalOnConnectionCreated = callback;
}

/**
 * Get an active connection by host ID.
 * @param {string} hostId
 * @returns {SSHConnectionManager|null}
 */
export function getConnection(hostId) {
  return activeConnections.get(hostId) || null;
}

/**
 * Create a new connection manager for a host. Destroys any existing connection for the same host.
 * @param {object} hostConfig
 * @returns {SSHConnectionManager}
 */
export function createConnection(hostConfig) {
  if (activeConnections.has(hostConfig.id)) {
    activeConnections.get(hostConfig.id).destroy();
  }
  const manager = new SSHConnectionManager(hostConfig);
  activeConnections.set(hostConfig.id, manager);
  if (globalOnConnectionCreated) {
    globalOnConnectionCreated(manager, hostConfig.id);
  }
  return manager;
}

/**
 * Remove and destroy an active connection.
 * @param {string} hostId
 */
export function removeConnection(hostId) {
  const manager = activeConnections.get(hostId);
  if (manager) {
    manager.destroy();
    activeConnections.delete(hostId);
  }
}

/**
 * Ensure a connection exists and is ready for a host. Creates and connects if needed.
 * Waits for the connection to reach 'ready' state before returning.
 * @param {string} hostId
 * @param {number} [timeoutMs=30000] - Max time to wait for ready state
 * @returns {Promise<SSHConnectionManager>}
 */
export async function ensureConnection(hostId, timeoutMs = 30000) {
  let mgr = activeConnections.get(hostId);

  // If already ready, return immediately
  if (mgr && mgr.state === CONNECTION_STATES.READY) {
    return mgr;
  }

  // If not connected at all, create and connect
  if (!mgr || mgr.state === CONNECTION_STATES.DISCONNECTED || mgr.state === CONNECTION_STATES.ERROR) {
    const hostConfig = remoteHostsDb.getById(hostId);
    if (!hostConfig) throw new Error(`Remote host not found: ${hostId}`);
    mgr = createConnection(hostConfig);
    mgr.connect().catch((err) => {
      console.error('[ConnectionManager:' + hostId + '] ensureConnection connect failed:', err.message);
    });
  }

  // Wait for ready state
  if (mgr.state !== CONNECTION_STATES.READY) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout waiting for ready state'));
      }, timeoutMs);

      const checkState = () => {
        if (mgr.state === CONNECTION_STATES.READY) {
          clearTimeout(timeout);
          mgr.removeListener('state', onStateChange);
          resolve();
        } else if (mgr.state === CONNECTION_STATES.ERROR || mgr.state === CONNECTION_STATES.DISCONNECTED || mgr.state === CONNECTION_STATES.FAILED) {
          clearTimeout(timeout);
          mgr.removeListener('state', onStateChange);
          reject(new Error(`Connection failed: ${mgr.state}`));
        }
      };

      const onStateChange = () => checkState();
      mgr.on('state', onStateChange);
      checkState(); // Check immediately in case state changed between checks
    });
  }

  return mgr;
}

/**
 * Get all active connections.
 * @returns {Map<string, SSHConnectionManager>}
 */
export function getAllConnections() {
  return activeConnections;
}
