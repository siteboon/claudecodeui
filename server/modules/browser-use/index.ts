/**
 * Lazily starts the Browser Use MCP stdio entrypoint. Keeping this import lazy
 * ensures the entrypoint loads environment configuration before its runtime is
 * evaluated.
 */
export async function startBrowserUseMcp(): Promise<void> {
  await import('./browser-use-mcp.js');
}

// browserUseRoutes / browserUseMcpRoutes: mounted by server/index.ts for HTTP and MCP endpoints.
export { default as browserUseRoutes } from './browser-use.routes.js';
export { default as browserUseMcpRoutes } from './browser-use-mcp.routes.js';
// browserUseService: used by HTTP routes and server initialization to reconcile MCP setup.
export { browserUseService } from './browser-use.service.js';
// getBrowserUseRuntime: used by CLI bootstrap inspection and browser-use consumers.
export { getBrowserUseRuntime } from './browser-use-runtime.js';

