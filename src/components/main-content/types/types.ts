import type { Dispatch, MouseEvent, RefObject, SetStateAction } from 'react';
import type { AppTab, Project, ProjectSession } from '../../../types/app';

export type SessionLifecycleHandler = (sessionId?: string | null) => void;

export interface DiffInfo {
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
}

export interface EditingFile {
  name: string;
  path: string;
  projectName?: string;
  diffInfo?: DiffInfo | null;
  [key: string]: unknown;
}

export interface TaskMasterTask {
  id: string | number;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  details?: string;
  testStrategy?: string;
  parentId?: string | number;
  dependencies?: Array<string | number>;
  subtasks?: TaskMasterTask[];
  [key: string]: unknown;
}

export interface TaskReference {
  id: string | number;
  title?: string;
  [key: string]: unknown;
}

export type TaskSelection = TaskMasterTask | TaskReference;

export interface PrdFile {
  name: string;
  content?: string;
  isExisting?: boolean;
  [key: string]: unknown;
}

export interface MainContentProps {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: unknown;
  isMobile: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  onInputFocusChange: (focused: boolean) => void;
  onSessionActive: SessionLifecycleHandler;
  onSessionInactive: SessionLifecycleHandler;
  onSessionProcessing: SessionLifecycleHandler;
  onSessionNotProcessing: SessionLifecycleHandler;
  processingSessions: Set<string>;
  onReplaceTemporarySession: SessionLifecycleHandler;
  onNavigateToSession: (targetSessionId: string) => void;
  onShowSettings: () => void;
  externalMessageUpdate: number;
}

export interface MainContentHeaderProps {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  isMobile: boolean;
  onMenuClick: () => void;
}

export interface MainContentStateViewProps {
  mode: 'loading' | 'empty';
  isMobile: boolean;
  onMenuClick: () => void;
}

export interface MobileMenuButtonProps {
  onMenuClick: () => void;
  compact?: boolean;
}

export interface EditorSidebarProps {
  editingFile: EditingFile | null;
  isMobile: boolean;
  editorExpanded: boolean;
  editorWidth: number;
  resizeHandleRef: RefObject<HTMLDivElement>;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onCloseEditor: () => void;
  onToggleEditorExpand: () => void;
  projectPath?: string;
  fillSpace?: boolean;
}

export interface TaskMasterPanelProps {
  isVisible: boolean;
}
