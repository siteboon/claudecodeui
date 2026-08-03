// browserUseService: used by the server composition root to manage browser sessions and viewers.
export { browserUseService } from './browser-use.service.js';

// VIEWER_COOKIE_NAME: used by WebSocket authentication to read the scoped viewer token.
export { VIEWER_COOKIE_NAME } from './browser-use.viewer.js';

// createBrowserUseApiAuthentication: used by the server composition root to protect Browser APIs.
// createBrowserUseViewerWebSocketAuthentication: used by WebSocket setup to validate viewer upgrades.
export {
  createBrowserUseApiAuthentication,
  createBrowserUseViewerWebSocketAuthentication,
} from './browser-use.auth.js';

/**
 * Lazily starts the Browser Use MCP stdio entrypoint. Keeping this import lazy
 * ensures the entrypoint loads environment configuration before its runtime is
 * evaluated.
 */
export async function startBrowserUseMcp(): Promise<void> {
  await import('./browser-use-mcp.js');
}
