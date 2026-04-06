/**
 * @module ccud/handlers/initialize
 * Initialize handshake handler.
 */
import { log } from '../logger.js';

const DAEMON_VERSION = '1.0.0';
const PROTOCOL_VERSION = 1;

export function handleInitialize(params) {
  log(`Initialize request from client v${params?.clientVersion || 'unknown'}, protocol v${params?.protocolVersion || 'unknown'}`);
  return {
    protocolVersion: PROTOCOL_VERSION,
    daemonVersion: DAEMON_VERSION,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

export { DAEMON_VERSION, PROTOCOL_VERSION };
