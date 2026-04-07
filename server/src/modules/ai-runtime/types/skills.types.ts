import type { LLMProvider } from '@/shared/types/app.js';

export type ProviderSkillScope = 'user' | 'project' | 'plugin' | 'repo' | 'admin' | 'system';

/**
 * Unified skill descriptor returned by provider skill runtimes.
 */
export type ProviderSkill = {
  provider: LLMProvider;
  scope: ProviderSkillScope;
  name: string;
  description?: string;
  invocation: string;
  filePath: string;
  pluginName?: string;
};

/**
 * Skills runtime contract for one provider.
 */
export interface IProviderSkillsRuntime {
  listSkills(options?: { workspacePath?: string }): Promise<ProviderSkill[]>;
}
