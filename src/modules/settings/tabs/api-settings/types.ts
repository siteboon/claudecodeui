import type { ApiKeyItem, CreatedApiKey, GithubCredentialItem } from '@/shared/types';




export type ApiKeysResponse = {
  apiKeys?: ApiKeyItem[];
  success?: boolean;
  error?: string;
  apiKey?: CreatedApiKey;
};

export type GithubCredentialsResponse = {
  credentials?: GithubCredentialItem[];
  success?: boolean;
  error?: string;
};
