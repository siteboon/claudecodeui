/**
 * @module ccud/index
 * Daemon entry point -- wires transport, handlers, PID, and signal handling.
 * Uses jsonrpc-lite for all JSON-RPC response construction.
 */
import jsonrpc from 'jsonrpc-lite';
import { log } from './logger.js';
import { writePidFile, removePidFile } from './pid.js';
import { createStdioTransport } from './transport.js';
import { handleInitialize } from './handlers/initialize.js';
import { handleFs } from './handlers/fs.js';
import { handleGit } from './handlers/git.js';
import { handleWatch, cleanupAllWatchers } from './handlers/watch.js';
import { handleClaude, cleanupAllClaudeSessions } from './handlers/claude.js';

// Write PID file immediately
writePidFile();

/**
 * Process a single JSON-RPC message and return a response (or null for notifications).
 * @param {object} msg - Raw JSON-RPC message object
 * @returns {object|null} JSON-RPC response or null for notifications
 */
async function processSingleMessage(msg) {
  // If msg has no method property, ignore (it's a response, not a request)
  if (!msg.method) return null;

  // If msg has no id property, it's a notification -- process but return null
  const isNotification = msg.id === undefined || msg.id === null;

  try {
    let result;
    let errorResult;

    if (msg.method === 'initialize') {
      result = handleInitialize(msg.params);
    } else if (msg.method.startsWith('fs/')) {
      const fsResult = await handleFs(msg.method, msg.params);
      if (fsResult.error) {
        errorResult = fsResult.error;
      } else {
        result = fsResult;
      }
    } else if (msg.method.startsWith('git/')) {
      const gitResult = await handleGit(msg.method, msg.params);
      if (gitResult.error) {
        errorResult = gitResult.error;
      } else {
        result = gitResult;
      }
    } else if (msg.method.startsWith('watch/')) {
      const watchResult = await handleWatch(msg.method, msg.params, transport);
      if (watchResult.error) {
        errorResult = watchResult.error;
      } else {
        result = watchResult;
      }
    } else if (msg.method.startsWith('claude/')) {
      const claudeResult = await handleClaude(msg.method, msg.params, transport);
      if (claudeResult.error) {
        errorResult = claudeResult.error;
      } else {
        result = claudeResult;
      }
    } else {
      errorResult = { code: -32601, message: 'Method not found' };
    }

    // Notifications get no response
    if (isNotification) return null;

    if (errorResult) {
      return jsonrpc.error(msg.id, new jsonrpc.JsonRpcError(errorResult.message, errorResult.code));
    }

    return jsonrpc.success(msg.id, result);
  } catch (err) {
    if (isNotification) return null;
    return jsonrpc.error(msg.id, new jsonrpc.JsonRpcError(err.message || 'Internal error', -32603));
  }
}

/**
 * Handle incoming JSON-RPC messages (single or batch).
 * @param {object|object[]} msg - Parsed JSON message or array of messages
 */
async function handleIncoming(msg) {
  if (Array.isArray(msg)) {
    // Batch request: process all in parallel, return array of responses
    const settled = await Promise.allSettled(msg.map((m) => processSingleMessage(m)));
    const results = settled.map((r) => r.status === 'fulfilled' ? r.value : null);
    const responses = results.filter(Boolean); // Filter out notification responses (null)
    if (responses.length) transport.send(responses);
    return;
  }
  const response = await processSingleMessage(msg);
  if (response) transport.send(response);
}

// Create stdio transport
const transport = createStdioTransport(handleIncoming);

// Cleanup function
let cleanedUp = false;
function cleanup() {
  if (cleanedUp) return;
  cleanedUp = true;
  cleanupAllWatchers();
  cleanupAllClaudeSessions();
  removePidFile();
  try {
    // Attempt to kill process group for child process cleanup
    process.kill(-process.pid, 'SIGTERM');
  } catch (e) {
    // May not be group leader -- not an error
  }
}

// Prevent unhandled rejections from crashing the daemon during shutdown
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  try { process.stderr.write(`[ccud] Unhandled rejection: ${msg}\n`); } catch { /* stderr may be closed */ }
});

// Signal handlers
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

log('Daemon started, PID ' + process.pid);
