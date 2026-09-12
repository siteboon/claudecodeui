import type { IProviderAuth } from '@/shared/interfaces.js';
import type { ProviderAuthStatus } from '@/shared/types.js';

/**
 * Phase 1 auth placeholder for Pi.
 *
 * Pi has no login subcommand — credentials come from its own `models.json` or
 * environment variables — so this reports the conservative "not installed /
 * not authenticated" state instead of probing a credential store that has no
 * stable layout yet. The real readiness check (`pi auth check`) lands with the
 * auth facet.
 */
export class PiProviderAuth implements IProviderAuth {
  async getStatus(): Promise<ProviderAuthStatus> {
    return {
      installed: false,
      provider: 'pi',
      authenticated: false,
      email: null,
      method: null,
      error: 'Pi not configured',
    };
  }
}
