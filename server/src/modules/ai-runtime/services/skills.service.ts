import { llmProviderRegistry } from '@/modules/ai-runtime/ai-runtime.registry.js';
import type { ProviderSkill } from '@/modules/ai-runtime/types/index.js';

export const llmSkillsService = {
  /**
   * Lists skills for one provider.
   */
  async listProviderSkills(
    providerName: string,
    options?: { workspacePath?: string },
  ): Promise<ProviderSkill[]> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.skills.listSkills(options);
  },
};
