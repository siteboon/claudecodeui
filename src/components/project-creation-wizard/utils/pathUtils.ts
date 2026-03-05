import type { WorkspaceType } from '../types';

const SSH_PREFIXES = ['git@', 'ssh://'];
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:\\?$/;

export const isSshGitUrl = (url: string): boolean => {
  const trimmedUrl = url.trim();
  return SSH_PREFIXES.some((prefix) => trimmedUrl.startsWith(prefix));
};

export const shouldShowGithubAuthentication = (
  workspaceType: WorkspaceType,
  githubUrl: string,
): boolean => workspaceType === 'new' && githubUrl.trim().length > 0 && !isSshGitUrl(githubUrl);

export const isCloneWorkflow = (workspaceType: WorkspaceType, githubUrl: string): boolean =>
  workspaceType === 'new' && githubUrl.trim().length > 0;

export const getSuggestionRootPath = (inputPath: string): string => {
  const trimmedPath = inputPath.trim();
  const lastSeparatorIndex = Math.max(trimmedPath.lastIndexOf('/'), trimmedPath.lastIndexOf('\\'));
  if (lastSeparatorIndex === 2 && /^[A-Za-z]:/.test(trimmedPath)) {
    return `${trimmedPath.slice(0, 2)}\\`;
  }

  return lastSeparatorIndex > 0 ? trimmedPath.slice(0, lastSeparatorIndex) : '~';
};

// Handles root edge cases for Unix-like and Windows paths.
export const getParentPath = (currentPath: string): string | null => {
  if (currentPath === '~' || currentPath === '/' || WINDOWS_DRIVE_PATTERN.test(currentPath)) {
    return null;
  }

  const lastSeparatorIndex = Math.max(currentPath.lastIndexOf('/'), currentPath.lastIndexOf('\\'));
  if (lastSeparatorIndex <= 0) {
    return '/';
  }

  if (lastSeparatorIndex === 2 && /^[A-Za-z]:/.test(currentPath)) {
    return `${currentPath.slice(0, 2)}\\`;
  }

  return currentPath.slice(0, lastSeparatorIndex);
};

export const joinFolderPath = (basePath: string, folderName: string): string => {
  const normalizedBasePath = basePath.trim().replace(/[\\/]+$/, '');
  const separator =
    normalizedBasePath.includes('\\') && !normalizedBasePath.includes('/') ? '\\' : '/';
  return `${normalizedBasePath}${separator}${folderName.trim()}`;
};
