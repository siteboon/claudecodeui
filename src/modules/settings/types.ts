import type { Dispatch, SetStateAction } from 'react';

import type { ClaudePermissionsState, CodexPermissionMode, CursorPermissionsState, LLMProvider, ProjectSortOrder, SettingsProject } from '@/shared/types';
import type { ProviderAuthStatus } from '@/shared/types';





export type SaveStatus = 'success' | 'error' | null;







export type SettingsStoragePayload = {
  claude: ClaudePermissionsState & { projectSortOrder: ProjectSortOrder; lastUpdated: string };
  cursor: CursorPermissionsState & { lastUpdated: string };
  codex: { permissionMode: CodexPermissionMode; lastUpdated: string };
};

export type SettingsProps = {
  isOpen: boolean;
  onClose: () => void;
  projects?: SettingsProject[];
  initialTab?: string;
};

export type SetState<T> = Dispatch<SetStateAction<T>>;
