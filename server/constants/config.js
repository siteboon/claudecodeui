import { resolveAuthMode } from '../../shared/authConfig.js';

/** Used by server startup to check the frontend artifact before accepting connections. */
export const AUTH_MODE = resolveAuthMode(process.env);
/** Used by platform-specific backend integrations. */
export const IS_PLATFORM = AUTH_MODE.isPlatform;
/** Used by auth and onboarding routes to enforce the local bypass setup contract. */
export const DISABLE_AUTH = AUTH_MODE.disableAuth;
/** Used by REST middleware, WebSocket upgrades, and CLI status for the effective mode. */
export const TRUST_LOCAL_AUTH_BYPASS = AUTH_MODE.trustLocalAuthBypass;
