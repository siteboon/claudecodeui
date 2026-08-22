// authRoutes: used by the server entrypoint to mount public authentication endpoints.
export { authRoutes } from './auth.module.js';

// authenticateToken: used by the server entrypoint to protect authenticated API modules.
export { authenticateToken } from './auth.middleware.js';
// authenticateWebSocket: used by WebSocket setup to verify connection tokens.
export { authenticateWebSocket } from './auth.middleware.js';
// generateDownloadToken: used by File Tree routes to mint short-lived single-file download capability tokens.
export { generateDownloadToken } from './auth.middleware.js';
// authenticateDownloadToken: used by the server entrypoint to protect the native file-download endpoint.
export { authenticateDownloadToken } from './auth.middleware.js';
// validateApiKey: used by the server entrypoint for optional API-wide key validation.
export { validateApiKey } from './auth.middleware.js';
