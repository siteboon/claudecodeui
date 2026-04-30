import type { ReactNode } from 'react';
import type { NavigateFunction } from 'react-router-dom';

import type { AppTab, Project } from '../../../types/app';

export type PaletteCtx = {
  projectId: string | undefined;
  selectedProject: Project | null;
  query: string;
  enabled: boolean;
  open: boolean;
  run: (fn: () => void) => void;
  navigate: NavigateFunction;
  toggleDarkMode: () => void;
  onStartNewChat: (project: Project) => void;
  onOpenSettings: (tab?: string) => void;
  onShowTab?: (tab: AppTab) => void;
  openFile: (path: string) => void;
};

export type PaletteItem = {
  key: string;
  value: string;
  node: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
};

export type GroupConfig = {
  id: string;
  heading: string;
  modes: string[];
  prefix?: { char: string; mode: string };
  requiresProject?: boolean;
  useItems: (ctx: PaletteCtx) => PaletteItem[];
};
