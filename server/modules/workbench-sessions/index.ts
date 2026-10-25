// Routers mounted by the server entrypoint at `/api/workbench` (JWT) and `/api/workbench-hooks` (token).
export { createWorkbenchHookRouter, createWorkbenchSessionsRouter } from './workbench-sessions.routes.js';
// Shell integration: launch spec and PTY lifecycle callbacks.
export {
  buildLaunch,
  buildRunLaunch,
  onSessionExit,
  onSessionLaunched,
  onSessionOutput,
} from './workbench-runtime.service.js';
export { registerPtyKiller } from './workbench-terminals.js';
export { workbenchSessionsStore } from './workbench-sessions.store.js';
// Used by the Hermes/agent module to turn an approved proposal into a session and to list status.
export { createSession, discardSession, getSessionView, listSessions } from './workbench-sessions.service.js';
export type { SessionView } from './workbench-sessions.service.js';
