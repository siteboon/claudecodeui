import { FILE_STATUS_BADGE_CLASSES, FILE_STATUS_GROUPS, FILE_STATUS_LABELS } from '../constants/constants';
import type { FileStatusCode, GitStatusResponse } from '../types/types';

export function getAllChangedFiles(gitStatus: GitStatusResponse | null): string[] {
  if (!gitStatus) {
    return [];
  }

  return FILE_STATUS_GROUPS.flatMap(({ key }) => gitStatus[key] || []);
}

export function getChangedFileCount(gitStatus: GitStatusResponse | null): number {
  return getAllChangedFiles(gitStatus).length;
}

export function hasChangedFiles(gitStatus: GitStatusResponse | null): boolean {
  return getChangedFileCount(gitStatus) > 0;
}

export function getStatusLabel(status: FileStatusCode): string {
  return FILE_STATUS_LABELS[status] || status;
}

export function getStatusBadgeClass(status: FileStatusCode): string {
  return FILE_STATUS_BADGE_CLASSES[status] || FILE_STATUS_BADGE_CLASSES.U;
}
