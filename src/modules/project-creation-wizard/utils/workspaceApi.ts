import { api } from '@/shared/api';
import type { FolderSuggestion, GithubTokenCredential, TokenMode } from '@/shared/types';

type CredentialsResponse = {
  credentials?: GithubTokenCredential[];
  error?: string;
};

type BrowseFilesystemResponse = {
  path?: string;
  suggestions?: FolderSuggestion[];
  error?: string;
};

type CreateFolderResponse = {
  success?: boolean;
  path?: string;
  error?: string;
  details?: string;
};

type CreateProjectPayload = {
  path: string;
  customName?: string;
};

type CreateProjectApiError = {
  code?: string;
  message?: string;
  details?: unknown;
};

type CreateProjectResponse = {
  success?: boolean;
  project?: Record<string, unknown>;
  error?: string | CreateProjectApiError;
  details?: string;
  message?: string;
};

type CloneProgressEvent = {
  type?: string;
  message?: string;
  project?: Record<string, unknown>;
};

type CloneWorkspaceParams = {
  workspacePath: string;
  githubUrl: string;
  tokenMode: TokenMode;
  selectedGithubToken: string;
  newGithubToken: string;
};

type CloneProgressHandlers = {
  onProgress: (message: string) => void;
};

const parseJson = async <T>(response: Response): Promise<T> => {
  const data = (await response.json()) as T;
  return data;
};

const resolveCreateProjectErrorMessage = (responseData: CreateProjectResponse): string | null => {
  if (typeof responseData.details === 'string' && responseData.details.trim().length > 0) {
    return responseData.details;
  }

  if (typeof responseData.error === 'string' && responseData.error.trim().length > 0) {
    return responseData.error;
  }

  if (responseData.error && typeof responseData.error === 'object') {
    const errorObject = responseData.error as { message?: unknown; details?: unknown };

    if (typeof errorObject.details === 'string' && errorObject.details.trim().length > 0) {
      return errorObject.details;
    }

    if (typeof errorObject.message === 'string' && errorObject.message.trim().length > 0) {
      return errorObject.message;
    }

    if (
      errorObject.details
      && typeof errorObject.details === 'object'
      && typeof (errorObject.details as { projectPath?: unknown }).projectPath === 'string'
    ) {
      return `Project path already exists: ${(errorObject.details as { projectPath: string }).projectPath}`;
    }
  }

  if (typeof responseData.message === 'string' && responseData.message.trim().length > 0) {
    return responseData.message;
  }

  return null;
};

export const fetchGithubTokenCredentials = async () => {
  const response = await api.settings.credentials('github_token');
  const data = await parseJson<CredentialsResponse>(response);

  if (!response.ok) {
    throw new Error(data.error || 'Failed to load GitHub tokens');
  }

  return (data.credentials || []).filter((credential) => credential.is_active);
};

export const browseFilesystemFolders = async (pathToBrowse: string) => {
  const response = await api.browseFilesystem(pathToBrowse);
  const data = await parseJson<BrowseFilesystemResponse>(response);

  if (!response.ok) {
    throw new Error(data.error || 'Failed to browse filesystem');
  }

  return {
    path: data.path || pathToBrowse,
    suggestions: (data.suggestions || []) as FolderSuggestion[],
  };
};

export const createFolderInFilesystem = async (folderPath: string) => {
  const response = await api.createFolder(folderPath);
  const data = await parseJson<CreateFolderResponse>(response);

  if (!response.ok) {
    throw new Error(data.error || 'Failed to create folder');
  }

  return data.path || folderPath;
};

export const createProjectRequest = async (payload: CreateProjectPayload) => {
  const response = await api.createProject(payload);
  const data = await parseJson<CreateProjectResponse>(response);

  if (!response.ok) {
    throw new Error(resolveCreateProjectErrorMessage(data) || 'Failed to create project');
  }

  return data.project;
};

const buildCloneProgressUrl = ({
  workspacePath,
  githubUrl,
  tokenMode,
  selectedGithubToken,
  newGithubToken,
}: CloneWorkspaceParams) =>
  api.cloneProjectProgressUrl({
    path: workspacePath.trim(),
    githubUrl: githubUrl.trim(),
    githubTokenId: tokenMode === 'stored' ? selectedGithubToken : null,
    newGithubToken: tokenMode === 'new' ? newGithubToken.trim() : null,
  });

export const cloneWorkspaceWithProgress = (
  params: CloneWorkspaceParams,
  handlers: CloneProgressHandlers,
) =>
  new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
    const eventSource = new EventSource(buildCloneProgressUrl(params));
    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      eventSource.close();
      callback();
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as CloneProgressEvent;

        if (payload.type === 'progress' && payload.message) {
          handlers.onProgress(payload.message);
          return;
        }

        if (payload.type === 'complete') {
          settle(() => resolve(payload.project));
          return;
        }

        if (payload.type === 'error') {
          settle(() => reject(new Error(payload.message || 'Failed to clone repository')));
        }
      } catch (error) {
        console.error('Error parsing clone progress event:', error);
      }
    };

    eventSource.onerror = () => {
      settle(() => reject(new Error('Connection lost during clone')));
    };
  });
