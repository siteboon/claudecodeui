/**
 * @module ccud/handlers/watch
 * File watcher handlers for watch/* RPC methods.
 * Uses chokidar to monitor directories and sends batched
 * watch/change JSON-RPC notifications through the transport.
 */
import chokidar from 'chokidar';

/** @type {Map<string, { watcher: import('chokidar').FSWatcher, transport: object, debounceTimer: ReturnType<typeof setTimeout>|null, pendingEvents: Array<{ event: string, filePath: string }> }>} */
const activeWatchers = new Map();

/**
 * Flush pending file events as a single batched notification.
 * @param {{ pendingEvents: Array<{ event: string, filePath: string }>, debounceTimer: ReturnType<typeof setTimeout>|null, transport: object }} state
 * @param {string} watchPath - The root watch path
 */
function flushEvents(state, watchPath) {
  if (state.pendingEvents.length === 0) return;
  const events = state.pendingEvents.splice(0);
  state.transport.send({
    jsonrpc: '2.0',
    method: 'watch/change',
    params: { watchPath, events },
  });
}

/**
 * Queue a file event for batched delivery.
 * @param {{ pendingEvents: Array, debounceTimer: ReturnType<typeof setTimeout>|null }} state
 * @param {string} watchPath - The root watch path
 * @param {string} event - Event type (add, change, unlink, addDir, unlinkDir)
 * @param {string} filePath - Absolute path of the changed file
 */
function queueEvent(state, watchPath, event, filePath) {
  state.pendingEvents.push({ event, filePath });
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => flushEvents(state, watchPath), 300);
}

/**
 * Handle all watch/* JSON-RPC methods.
 *
 * Supported methods:
 * - watch/start: Start watching a directory for file changes
 * - watch/stop: Stop watching a directory
 *
 * Unlike handleFs, this handler receives the transport reference because
 * it needs to send async notifications outside the request-response cycle.
 *
 * @param {string} method - The RPC method name (e.g., 'watch/start')
 * @param {object} params - Method parameters
 * @param {object} transport - The stdio transport for sending notifications
 * @returns {Promise<object>} Result object or error object with { error: { code, message } }
 */
export async function handleWatch(method, params, transport) {
  switch (method) {
    case 'watch/start': {
      if (activeWatchers.has(params.path)) {
        return { already: true };
      }

      const watcher = chokidar.watch(params.path, {
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/build/**',
          ...(params.options?.ignored || []),
        ],
        persistent: true,
        ignoreInitial: true,
        depth: params.options?.depth ?? 10,
      });

      const state = {
        watcher,
        transport,
        debounceTimer: null,
        pendingEvents: [],
      };

      watcher.on('add', (filePath) => queueEvent(state, params.path, 'add', filePath));
      watcher.on('change', (filePath) => queueEvent(state, params.path, 'change', filePath));
      watcher.on('unlink', (filePath) => queueEvent(state, params.path, 'unlink', filePath));
      watcher.on('addDir', (filePath) => queueEvent(state, params.path, 'addDir', filePath));
      watcher.on('unlinkDir', (filePath) => queueEvent(state, params.path, 'unlinkDir', filePath));
      watcher.on('error', (err) => console.error('[watch] Error:', err.message));

      activeWatchers.set(params.path, state);
      return { started: true };
    }

    case 'watch/stop': {
      const state = activeWatchers.get(params.path);
      if (!state) {
        return { stopped: false };
      }
      await state.watcher.close();
      clearTimeout(state.debounceTimer);
      activeWatchers.delete(params.path);
      return { stopped: true };
    }

    default:
      return { error: { code: -32601, message: 'Method not found: ' + method } };
  }
}

/**
 * Close all active watchers and clear pending timers.
 * Called during daemon shutdown to release resources.
 */
export function cleanupAllWatchers() {
  for (const [path, state] of activeWatchers) {
    clearTimeout(state.debounceTimer);
    state.watcher.close().catch(() => {});
    activeWatchers.delete(path);
  }
}
