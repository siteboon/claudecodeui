export { sessionSynchronizerService } from './services/session-synchronizer.service.js';
// sessionsService: used by Projects (to clean up provider storage during project force-delete)
// and Routes/Websocket to manage session state.
export { sessionsService } from './services/sessions.service.js';
export { providerSkillsService } from './services/skills.service.js';
export { providerMcpService } from './services/mcp.service.js';
export { providerRuntimeService } from './services/provider-runtime.service.js';

// providerModelsService: used by Commands to list models and resolve the active session model.
export { providerModelsService } from './services/provider-models.service.js';
export { providerTokenUsageService } from './services/provider-token-usage.service.js';

export { initializeSessionsWatcher } from './services/sessions-watcher.service.js';
export { closeSessionsWatcher } from './services/sessions-watcher.service.js';

// sessionsAutoArchiveService: used by Server bootstrap and Provider routes to manage
// session auto-archive configuration and background lifecycle.
export {
  sessionsAutoArchiveService,
  type SessionsAutoArchiveSettings,
} from './services/sessions-auto-archive.service.js';


// shutdownZCodeRuntime: used by the server entrypoint (server/index.ts) to stop
// the shared ZCode app-server subprocess during the shutdown flow.
export { shutdownZCodeRuntime } from './list/zcode/index.js';

// getAntigravityBrainRoots: used by the File Tree composition root as the
// read-only allowlist for workspace-external Antigravity plan documents.
export { getAntigravityBrainRoots } from './list/antigravity/index.js';

export type {
  AntigravityQuotaData,
  AntigravityQuotaGroup,
  AntigravityQuotaBucket,
} from './list/antigravity/index.js';
