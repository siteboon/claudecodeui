export type WizardStep = 1 | 2 | 3;

export type WorkspaceType = 'existing' | 'new';

export type TokenMode = 'stored' | 'new' | 'none';

export type FolderSuggestion = {
  name: string;
  path: string;
  type?: string;
};

export type GithubTokenCredential = {
  id: number;
  credential_name: string;
  is_active: boolean;
};

export type CredentialsResponse = {
  credentials?: GithubTokenCredential[];
  error?: string;
};

export type BrowseFilesystemResponse = {
  path?: string;
  suggestions?: FolderSuggestion[];
  error?: string;
};

export type CreateFolderResponse = {
  success?: boolean;
  path?: string;
  error?: string;
  details?: string;
};

export type CreateWorkspacePayload = {
  workspaceType: WorkspaceType;
  path: string;
};

export type CreateWorkspaceResponse = {
  success?: boolean;
  project?: Record<string, unknown>;
  error?: string;
  details?: string;
};

export type CloneProgressEvent = {
  type?: string;
  message?: string;
  project?: Record<string, unknown>;
};

export type WizardFormState = {
  workspaceType: WorkspaceType;
  workspacePath: string;
  githubUrl: string;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
};
