import { ApiRequestError, api } from '@/shared/api';
import type {
  ExistingProjectConflict,
  FolderSuggestion,
  GithubTokenCredential,
  Project,
  TokenMode,
} from '@/shared/types';

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
    const errorObject = data.error && typeof data.error === 'object' ? data.error : null;
    throw new ApiRequestError(
      resolveCreateProjectErrorMessage(data) || 'Failed to create project',
      {
        code: typeof errorObject?.code === 'string' ? errorObject.code : undefined,
        details: errorObject?.details ?? data.details,
        status: response.status,
      },
    );
  }

  return data.project;
};

const normalizeComparablePath = (rawPath: string): string => {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return '';
  }

  const unified = trimmed.replace(/\\/g, '/');
  const withoutTrailing = unified === '/' || /^[a-zA-Z]:\/$/.test(unified)
    ? unified
    : unified.replace(/\/+$/, '');

  return /^[a-zA-Z]:/.test(withoutTrailing) ? withoutTrailing.toLowerCase() : withoutTrailing;
};

const extractPathFromConflictText = (rawText: string): string | null => {
  const prefix = 'Project path already exists:';
  if (!rawText.startsWith(prefix)) {
    return null;
  }

  const extracted = rawText.slice(prefix.length).trim();
  return extracted || null;
};

const resolvePathBasename = (rawPath: string | undefined): string => {
  if (!rawPath) {
    return '';
  }

  const normalized = rawPath.trim().replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || normalized;
};

/**
 * Extracts structured metadata for an active-project conflict from a failed
 * create-project request, falling back to matching `existingProjects` by path
 * when talking to an older server that only returns a path string.
 */
export const resolveExistingProjectConflict = (
  error: unknown,
  existingProjects: Project[],
  attemptedPath: string,
): ExistingProjectConflict | null => {
  if (!(error instanceof ApiRequestError)) {
    return null;
  }

  if (error.code !== 'PROJECT_ALREADY_EXISTS' && error.status !== 409) {
    return null;
  }

  const detailsRecord =
    error.details && typeof error.details === 'object'
      ? (error.details as { projectId?: unknown; displayName?: unknown; projectPath?: unknown })
      : null;

  const projectIdFromDetails =
    typeof detailsRecord?.projectId === 'string' && detailsRecord.projectId.trim().length > 0
      ? detailsRecord.projectId.trim()
      : null;
  const projectPathFromDetails =
    typeof detailsRecord?.projectPath === 'string' && detailsRecord.projectPath.trim().length > 0
      ? detailsRecord.projectPath.trim()
      : typeof error.details === 'string'
        ? extractPathFromConflictText(error.details)
        : extractPathFromConflictText(error.message);

  if (projectIdFromDetails) {
    const matchedById = existingProjects.find((project) => project.projectId === projectIdFromDetails);
    const displayNameFromDetails =
      typeof detailsRecord?.displayName === 'string' && detailsRecord.displayName.trim().length > 0
        ? detailsRecord.displayName.trim()
        : '';

    return {
      projectId: projectIdFromDetails,
      displayName:
        displayNameFromDetails
        || matchedById?.displayName
        || resolvePathBasename(projectPathFromDetails ?? undefined)
        || projectIdFromDetails,
      projectPath: projectPathFromDetails ?? matchedById?.fullPath ?? matchedById?.path,
    };
  }

  const comparableCandidate = normalizeComparablePath(projectPathFromDetails || attemptedPath);
  if (!comparableCandidate) {
    return null;
  }

  const matchedByPath = existingProjects.find((project) => {
    const candidate = normalizeComparablePath(project.fullPath || project.path || '');
    return candidate.length > 0 && candidate === comparableCandidate;
  });

  if (!matchedByPath) {
    return null;
  }

  return {
    projectId: matchedByPath.projectId,
    displayName: matchedByPath.displayName,
    projectPath: matchedByPath.fullPath || matchedByPath.path,
  };
};

type StartCloneResponse = {
  cloneId?: string;
  error?: string | CreateProjectApiError;
};

// Submits the clone details — token included — in a request body and returns
// the id the progress stream is opened with, so the token never enters a URL.
const startClone = async ({
  workspacePath,
  githubUrl,
  tokenMode,
  selectedGithubToken,
  newGithubToken,
}: CloneWorkspaceParams) => {
  const response = await api.startProjectClone({
    path: workspacePath.trim(),
    githubUrl: githubUrl.trim(),
    githubTokenId: tokenMode === 'stored' && selectedGithubToken ? Number(selectedGithubToken) : null,
    newGithubToken: tokenMode === 'new' ? newGithubToken.trim() : null,
  });
  const data = await parseJson<StartCloneResponse>(response);

  if (!response.ok || !data.cloneId) {
    const errorMessage = typeof data.error === 'string' ? data.error : data.error?.message;
    throw new Error(errorMessage || 'Failed to start clone');
  }

  return data.cloneId;
};

const streamCloneProgress = (
  cloneId: string,
  handlers: CloneProgressHandlers,
) =>
  new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
    const eventSource = new EventSource(api.cloneProjectProgressUrl({ cloneId }));
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

export const cloneWorkspaceWithProgress = async (
  params: CloneWorkspaceParams,
  handlers: CloneProgressHandlers,
) => streamCloneProgress(await startClone(params), handlers);
