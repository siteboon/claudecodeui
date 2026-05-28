import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { ProviderSkill, ProviderSkillListOptions } from '@/shared/types.js';

export const providerSkillsService = {
  /**
   * Lists normalized skills visible to one provider.
   */
  async listProviderSkills(
    providerName: string,
    options?: ProviderSkillListOptions,
  ): Promise<ProviderSkill[]> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.skills.listSkills(options);
  },
};
