/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
// `import.meta.env` only exists under Vite. Node test runs import this module
// directly, so the flag is read behind an explicit guard rather than optional
// chaining, which would stop Vite from statically substituting the literal.
const platformEnvironmentFlag = import.meta.env
  ? import.meta.env.VITE_IS_PLATFORM
  : undefined;

export const IS_PLATFORM = platformEnvironmentFlag === 'true';
