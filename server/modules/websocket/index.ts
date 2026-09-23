export { WS_OPEN_STATE, connectedClients } from './services/websocket-state.service.js';
export { createWebSocketServer } from './services/websocket-server.service.js';
export { chatRunRegistry } from './services/chat-run-registry.service.js';
// Consumed by the providers module's sessions watcher, which announces the
// sessions it (re)indexed from disk through the same builder the chat gateway
// uses, so both paths put the identical delta on the wire.
export { broadcastSessionUpserted, broadcastSessionUpsertedBatch } from './services/session-upsert-broadcast.service.js';
// runDetachedChatTurn: used by the scheduled-messages module to run a turn
// from a timer, with no socket to stream to or report errors on.
export { runDetachedChatTurn } from './services/chat-websocket.service.js';
export type { ProviderRuntimeGateway } from './services/chat-websocket.service.js';
// isSessionHeldByShell: used by the scheduled-messages module to keep a queued
// turn pending, and by the agent module to refuse an API run, while the user
// is working on the session in a Shell CLI. endUnusedShellsForSession: used by
// the agent module to end a Shell CLI that was only opened before its run.
export { endUnusedShellsForSession, isSessionHeldByShell } from './services/shell-websocket.service.js';
