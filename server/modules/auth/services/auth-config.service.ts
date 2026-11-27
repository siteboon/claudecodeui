import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { AuthMode } from '../../../../shared/authConfig.js';

/**
 * Used by server startup before listening, so a stale or differently configured
 * frontend cannot silently use a different login, REST, or WebSocket auth mode.
 * A source-only development checkout has no frontend artifact to validate.
 */
export function validateFrontendAuthMode(frontendDirectory: string, serverMode: AuthMode): void {
  if (!existsSync(path.join(frontendDirectory, 'index.html'))) {
    return;
  }

  let frontendMode: unknown;
  try {
    frontendMode = JSON.parse(readFileSync(path.join(frontendDirectory, 'auth-config.json'), 'utf8'));
  } catch {
    throw new Error('Frontend authentication configuration is missing or invalid. Run npm run build with the server authentication settings, then restart CloudCLI.');
  }

  if (
    !frontendMode || typeof frontendMode !== 'object' ||
    !('isPlatform' in frontendMode) || frontendMode.isPlatform !== serverMode.isPlatform ||
    !('disableAuth' in frontendMode) || frontendMode.disableAuth !== serverMode.disableAuth ||
    !('trustLocalAuthBypass' in frontendMode) || frontendMode.trustLocalAuthBypass !== serverMode.trustLocalAuthBypass
  ) {
    throw new Error('Frontend and server authentication settings do not match. Set DISABLE_AUTH (and VITE_DISABLE_AUTH, if used) consistently for npm run build and the server runtime, then restart CloudCLI.');
  }
}
