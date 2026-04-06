/**
 * Remote SSH connection constants
 * @module constants/remote
 */

export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  DEPLOYING: 'deploying',
  INITIALIZING: 'initializing',
  READY: 'ready',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
  FAILED: 'failed',
};

export const MAX_RECONNECT_ATTEMPTS = 10;
export const BASE_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30000;
export const JITTER_MS = 2000;
export const SSH_KEEPALIVE_INTERVAL_MS = 10000;
export const SSH_KEEPALIVE_COUNT_MAX = 3;
export const SSH_READY_TIMEOUT_MS = 20000;
export const DAEMON_READY_TIMEOUT_MS = 10000;
export const RPC_DEFAULT_TIMEOUT_MS = 30000;
export const DAEMON_REMOTE_DIR = '.ccud';
export const DAEMON_REMOTE_PATH = '.ccud/ccud.mjs';
export const DAEMON_PID_PATH = '.ccud/ccud.pid';
export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
