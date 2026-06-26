import type { LLMProvider } from '../../types/app';

export type SkillsProvider = LLMProvider;
export type SkillsScope = 'user' | 'project' | 'plugin' | 'repo' | 'admin' | 'system';

export type SkillsProject = {
  projectId: string;
  displayName?: string;
  fullPath?: string;
  path?: string;
};

export type ProviderSkill = {
  provider: SkillsProvider;
  name: string;
  description: string;
  command: string;
  scope: SkillsScope;
  sourcePath: string;
  pluginName?: string;
  pluginId?: string;
  projectDisplayName?: string;
  projectPath?: string;
};

export type ProviderSkillCreateEntryPayload = {
  content: string;
  directoryName?: string;
  fileName?: string;
  files?: Array<{
    relativePath: string;
    content: string;
    encoding: 'base64';
  }>;
};

export type ProviderSkillCreatePayload = {
  entries: ProviderSkillCreateEntryPayload[];
};

export type ProviderSkillsResponse = {
  provider: SkillsProvider;
  skills: Array<Partial<ProviderSkill>>;
};

export type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

export type ApiErrorResponse = {
  success: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
