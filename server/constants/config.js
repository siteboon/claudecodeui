/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';
console.log(`[config] IS_PLATFORM=${IS_PLATFORM} (VITE_IS_PLATFORM=${JSON.stringify(process.env.VITE_IS_PLATFORM)})`);