/**
 * @module ccud/transport
 * Stdin/stdout JSON-RPC transport with newline framing.
 * Uses jsonrpc-lite for message validation.
 */
import { createInterface } from 'readline';
import jsonrpc from 'jsonrpc-lite';
import { log, error as logError } from './logger.js';

export function createStdioTransport(onMessage) {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

  const sendInternalError = (id, err) => {
    if (id === undefined || id === null) {
      return;
    }

    try {
      const code = typeof err?.code === 'number' ? err.code : -32603;
      const message = err instanceof Error ? err.message : 'Internal error';
      process.stdout.write(JSON.stringify(
        jsonrpc.error(id, new jsonrpc.JsonRpcError(message, code)),
      ) + '\n');
    } catch {
      // stdout may already be closed during shutdown
    }
  };

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      // Use jsonrpc-lite to validate and classify the message
      if (Array.isArray(parsed)) {
        // Batch request -- pass array of parsed objects
        Promise.resolve(onMessage(parsed)).catch((err) => {
          logError(`Unhandled batch RPC error: ${err.message}`);
          for (const message of parsed) {
            sendInternalError(message?.id, err);
          }
        });
      } else {
        const rpcObj = jsonrpc.parseObject(parsed);
        Promise.resolve(onMessage(parsed, rpcObj)).catch((err) => {
          logError(`Unhandled RPC error for ${parsed.method || 'unknown method'}: ${err.message}`);
          sendInternalError(parsed.id, err);
        });
      }
    } catch (e) {
      logError(`Invalid JSON-RPC: ${e.message}`);
    }
  });

  // CRITICAL: stdin close = SSH disconnected = self-terminate
  rl.on('close', () => {
    log('stdin closed, shutting down');
    // Grace period for pending operations
    setTimeout(() => process.exit(0), 5000);
  });

  return {
    send(msg) {
      process.stdout.write(JSON.stringify(msg) + '\n');
    },
  };
}
