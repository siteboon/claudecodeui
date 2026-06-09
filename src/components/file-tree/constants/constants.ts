import type { FileTreeViewMode } from '../types/types';

export const FILE_TREE_VIEW_MODE_STORAGE_KEY = 'file-tree-view-mode';

export const FILE_TREE_DEFAULT_VIEW_MODE: FileTreeViewMode = 'detailed';

export const FILE_TREE_VIEW_MODES: FileTreeViewMode[] = ['simple', 'compact', 'detailed'];

export const MAX_FILE_UPLOAD_SIZE_MB = 200;

export const MAX_FILE_UPLOAD_SIZE_BYTES = MAX_FILE_UPLOAD_SIZE_MB * 1024 * 1024;

export const MAX_FILE_UPLOAD_SIZE_LABEL = `${MAX_FILE_UPLOAD_SIZE_MB}MB`;

export const MAX_FILE_UPLOAD_COUNT = 20;

export const IMAGE_FILE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'ico',
  'bmp',
]);
