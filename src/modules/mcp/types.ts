import type { LLMProvider, McpProvider } from '@/shared/types';





export type McpFormMode = 'provider' | 'global';





export type GlobalMcpServerResult = {
  provider: McpProvider;
  created: boolean;
  error?: string;
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
