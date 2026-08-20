import type { LLMProvider, ProviderSkill, ProviderSkillCreateEntryPayload, SkillsProvider } from '@/shared/types';






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
