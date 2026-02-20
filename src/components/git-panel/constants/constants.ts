import type { ConfirmActionType, FileStatusCode, GitStatusGroupEntry } from '../types/types';

export const DEFAULT_BRANCH = 'main';
export const RECENT_COMMITS_LIMIT = 10;

export const FILE_STATUS_GROUPS: GitStatusGroupEntry[] = [
  { key: 'modified', status: 'M' },
  { key: 'added', status: 'A' },
  { key: 'deleted', status: 'D' },
  { key: 'untracked', status: 'U' },
];

export const FILE_STATUS_LABELS: Record<FileStatusCode, string> = {
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  U: 'Untracked',
};

export const FILE_STATUS_BADGE_CLASSES: Record<FileStatusCode, string> = {
  M: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800/50',
  A: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800/50',
  D: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800/50',
  U: 'bg-muted text-muted-foreground border-border',
};

export const CONFIRMATION_TITLES: Record<ConfirmActionType, string> = {
  discard: 'Discard Changes',
  delete: 'Delete File',
  commit: 'Confirm Commit',
  pull: 'Confirm Pull',
  push: 'Confirm Push',
  publish: 'Publish Branch',
};

export const CONFIRMATION_ACTION_LABELS: Record<ConfirmActionType, string> = {
  discard: 'Discard',
  delete: 'Delete',
  commit: 'Commit',
  pull: 'Pull',
  push: 'Push',
  publish: 'Publish',
};

export const CONFIRMATION_BUTTON_CLASSES: Record<ConfirmActionType, string> = {
  discard: 'bg-red-600 hover:bg-red-700',
  delete: 'bg-red-600 hover:bg-red-700',
  commit: 'bg-primary hover:bg-primary/90',
  pull: 'bg-green-600 hover:bg-green-700',
  push: 'bg-orange-600 hover:bg-orange-700',
  publish: 'bg-purple-600 hover:bg-purple-700',
};

export const CONFIRMATION_ICON_CONTAINER_CLASSES: Record<ConfirmActionType, string> = {
  discard: 'bg-red-100 dark:bg-red-900/30',
  delete: 'bg-red-100 dark:bg-red-900/30',
  commit: 'bg-yellow-100 dark:bg-yellow-900/30',
  pull: 'bg-yellow-100 dark:bg-yellow-900/30',
  push: 'bg-yellow-100 dark:bg-yellow-900/30',
  publish: 'bg-yellow-100 dark:bg-yellow-900/30',
};

export const CONFIRMATION_ICON_CLASSES: Record<ConfirmActionType, string> = {
  discard: 'text-red-600 dark:text-red-400',
  delete: 'text-red-600 dark:text-red-400',
  commit: 'text-yellow-600 dark:text-yellow-400',
  pull: 'text-yellow-600 dark:text-yellow-400',
  push: 'text-yellow-600 dark:text-yellow-400',
  publish: 'text-yellow-600 dark:text-yellow-400',
};
