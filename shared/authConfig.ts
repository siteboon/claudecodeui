/** Authentication mode shared by the Vite build and server runtime. */
export type AuthMode = {
  isPlatform: boolean;
  disableAuth: boolean;
  trustLocalAuthBypass: boolean;
};

/**
 * Used by Vite and server configuration to resolve the same authentication mode.
 * DISABLE_AUTH is canonical; VITE_DISABLE_AUTH remains a compatible alias, but
 * explicitly configured flags must agree. No identity headers are trusted here.
 */
export function resolveAuthMode(environment: Record<string, string | undefined>): AuthMode {
  const serverFlag = environment.DISABLE_AUTH || undefined;
  const frontendFlag = environment.VITE_DISABLE_AUTH || undefined;
  for (const flag of [serverFlag, frontendFlag]) {
    if (flag !== undefined && flag !== 'true' && flag !== 'false') {
      throw new Error('DISABLE_AUTH and VITE_DISABLE_AUTH must be true or false.');
    }
  }
  if (serverFlag !== undefined && frontendFlag !== undefined && serverFlag !== frontendFlag) {
    throw new Error('DISABLE_AUTH and VITE_DISABLE_AUTH must match. Rebuild the frontend and restart CloudCLI with the same settings.');
  }

  const isPlatform = environment.VITE_IS_PLATFORM === 'true';
  const disableAuth = (serverFlag ?? frontendFlag) === 'true';
  return { isPlatform, disableAuth, trustLocalAuthBypass: isPlatform || disableAuth };
}
