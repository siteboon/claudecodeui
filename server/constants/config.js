/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';
export const DISABLE_AUTH = process.env.DISABLE_AUTH === 'true' || process.env.VITE_DISABLE_AUTH === 'true';
export const TRUST_LOCAL_AUTH_BYPASS = IS_PLATFORM || DISABLE_AUTH;
