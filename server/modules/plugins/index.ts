// pluginsRoutes: used by the server entrypoint to mount protected plugin-management endpoints.
export { pluginsRoutes } from './plugins.module.js';

// startEnabledPluginServers: used by the server entrypoint to start enabled plugin subprocesses.
export { startEnabledPluginServers } from './plugin-process.service.js';
// stopAllPlugins: used by the server entrypoint to stop plugin subprocesses during shutdown.
export { stopAllPlugins } from './plugin-process.service.js';
// loadProviderPlugins: used by the server entrypoint to register chat providers from plugins before the session watcher starts.
export { loadProviderPlugins } from './provider-plugin-loader.js';
export type { ProviderPluginHost } from './provider-plugin-loader.js';
// getPluginPort: used by WebSocket setup in the server entrypoint to proxy plugin connections.
export { getPluginPort } from './plugin-process.service.js';
