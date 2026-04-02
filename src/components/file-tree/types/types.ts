import type { LucideIcon } from 'lucide-react';

export type FileTreeViewMode = 'simple' | 'compact' | 'detailed';

export type FileTreeItemType = 'file' | 'directory';

export interface FileTreeNode {
  name: string;
  type: FileTreeItemType;
  path: string;
  size?: number;
  modified?: string;
  permissionsRwx?: string;
  children?: FileTreeNode[];
  [key: string]: unknown;
}

export interface FileTreeImageSelection {
  name: string;
  path: string;
  projectPath?: string;
  projectName: string;
}

export interface FileIconData {
  icon: LucideIcon;
  color: string;
}

export type FileIconMap = Record<string, FileIconData>;
