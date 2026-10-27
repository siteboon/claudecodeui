/**
 * Lazily starts the Browser Use MCP stdio entrypoint. Keeping this import lazy
 * ensures the entrypoint loads environment configuration before its runtime is
 * evaluated.
 */
export async function startBrowserUseMcp(): Promise<void> {
  await import('./browser-use-mcp.js');
}

// getBrowserUseRuntime: used by Browser Use services and environment-mode regression coverage.
export { getBrowserUseRuntime } from './browser-use-runtime.js';

// handleBrowserViewConnection: used by the websocket module's gateway to
// serve the /browser-view viewer path. Loaded lazily because this barrel is
// also imported by the CLI bootstrap, which must not pull the Playwright
// service graph (browser-use.service → providers → provider SDKs) into every
// CLI process.
export async function handleBrowserViewConnection(
  ws: import('ws').WebSocket,
  request: import('@/shared/types.js').AuthenticatedWebSocketRequest,
  auth: {
    isPlatform: boolean;
    authenticateWebSocket: (token: string | null) => { [key: string]: unknown } | null;
  },
): Promise<void> {
  const { handleBrowserViewConnection: handle } = await import('./browser-view-websocket.service.js');
  handle(ws, request, auth);
}
