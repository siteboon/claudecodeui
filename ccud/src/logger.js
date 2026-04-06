/**
 * @module ccud/logger
 * Daemon logging -- stderr only. stdout is reserved for JSON-RPC.
 * CRITICAL: NEVER use console.log -- it writes to stdout and corrupts JSON-RPC.
 */

export function log(...args) {
  process.stderr.write(`[ccud] ${args.join(' ')}\n`);
}

export function error(...args) {
  process.stderr.write(`[ccud:error] ${args.join(' ')}\n`);
}
