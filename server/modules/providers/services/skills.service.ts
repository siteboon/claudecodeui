import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type {
  ProviderSkill,
  ProviderSkillCreateInput,
  ProviderSkillListOptions,
  ProviderSkillRemoveInput,
  ProviderSkillRegistryActionResult,
  ProviderSkillRegistryInstallInput,
  ProviderSkillRegistrySearchOptions,
  ProviderSkillRegistrySearchResult,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const getProviderSkills = (providerName: string) => providerRegistry.resolveProvider(providerName).skills;

const requireSkillRegistryMethod = <TMethod extends keyof ReturnType<typeof getProviderSkills>>(
  providerName: string,
  methodName: TMethod,
): NonNullable<ReturnType<typeof getProviderSkills>[TMethod]> => {
  const skills = getProviderSkills(providerName);
  const method = skills[methodName];
  if (typeof method !== 'function') {
    throw new AppError(`${providerName} does not support skill registry operations.`, {
      code: 'PROVIDER_SKILL_REGISTRY_UNSUPPORTED',
      statusCode: 400,
    });
  }
  return method as NonNullable<ReturnType<typeof getProviderSkills>[TMethod]>;
};

export const providerSkillsService = {
  /**
   * Lists normalized skills visible to one provider.
   */
  async listProviderSkills(
    providerName: string,
    options?: ProviderSkillListOptions,
  ): Promise<ProviderSkill[]> {
    return getProviderSkills(providerName).listSkills(options);
  },

  /**
   * Writes one or more global skills for one provider.
   */
  async addProviderSkills(
    providerName: string,
    input: ProviderSkillCreateInput,
  ): Promise<ProviderSkill[]> {
    return getProviderSkills(providerName).addSkills(input);
  },

  async searchSkillRegistry(
    providerName: string,
    query: string,
    options?: ProviderSkillRegistrySearchOptions,
  ): Promise<ProviderSkillRegistrySearchResult[]> {
    const searchRegistry = requireSkillRegistryMethod(providerName, 'searchRegistry');
    return searchRegistry.call(getProviderSkills(providerName), query, options);
  },

  async installRegistrySkill(
    providerName: string,
    input: ProviderSkillRegistryInstallInput,
  ): Promise<ProviderSkillRegistryActionResult> {
    const installRegistrySkill = requireSkillRegistryMethod(providerName, 'installRegistrySkill');
    return installRegistrySkill.call(getProviderSkills(providerName), input);
  },

  async uninstallRegistrySkill(providerName: string, name: string): Promise<ProviderSkillRegistryActionResult> {
    const uninstallRegistrySkill = requireSkillRegistryMethod(providerName, 'uninstallRegistrySkill');
    return uninstallRegistrySkill.call(getProviderSkills(providerName), name);
  },

  async checkRegistryUpdates(providerName: string): Promise<ProviderSkillRegistryActionResult> {
    const checkRegistryUpdates = requireSkillRegistryMethod(providerName, 'checkRegistryUpdates');
    return checkRegistryUpdates.call(getProviderSkills(providerName));
  },

  async updateRegistrySkills(providerName: string): Promise<ProviderSkillRegistryActionResult> {
    const updateRegistrySkills = requireSkillRegistryMethod(providerName, 'updateRegistrySkills');
    return updateRegistrySkills.call(getProviderSkills(providerName));
  },

  async auditRegistrySkills(providerName: string): Promise<ProviderSkillRegistryActionResult> {
    const auditRegistrySkills = requireSkillRegistryMethod(providerName, 'auditRegistrySkills');
    return auditRegistrySkills.call(getProviderSkills(providerName));
  },

  async removeProviderSkill(
    providerName: string,
    input: ProviderSkillRemoveInput,
  ): Promise<{ removed: boolean; provider: string; directoryName: string }> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.skills.removeSkill(input);
  },
};
