/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = Boolean(import.meta.env?.VITE_IS_PLATFORM === 'true');
