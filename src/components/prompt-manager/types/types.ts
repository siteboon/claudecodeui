export type PromptType = 'role' | 'template';
export type PromptCategory = 'engineering' | 'content' | 'analysis' | 'custom' | 'debugging' | 'quality' | 'documentation' | 'improvement' | 'testing';
export type PromptNamespace = 'builtin' | 'user' | 'project';

export interface Prompt {
  name: string;
  type: PromptType;
  category: PromptCategory;
  description: string;
  icon?: string;
  tags?: string[];
  path: string;
  namespace?: PromptNamespace | null;
  metadata?: Record<string, unknown>;
}

export interface ActiveRole {
  name: string;
  content: string;
  icon?: string;
}

export interface PromptsListResponse {
  prompts: Prompt[];
  builtIn: Prompt[];
  user: Prompt[];
  project: Prompt[];
  count: number;
}

export interface PromptLoadResponse {
  path: string;
  metadata: Record<string, unknown>;
  content: string;
}
