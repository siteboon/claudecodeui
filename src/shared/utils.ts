/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
// Optional-chained so this module can be imported outside Vite, where
// `import.meta.env` is undefined — without it any test that reaches client code
// throws on import. (PR #1174 makes the same one-line change independently.)
export const IS_PLATFORM = import.meta.env?.VITE_IS_PLATFORM === 'true';
