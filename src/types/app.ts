export type LLMProvider = 'claude' | 'cursor' | 'codex' | 'gemini';

export type SessionStatus = 'running' | 'waiting' | 'error' | 'idle' | 'done';

export type AppTab = 'chat' | 'files' | 'shell' | 'git' | 'tasks' | 'preview' | `plugin:${string}`;

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  /**
   * User-assigned display name. When present, wins over CLI-derived
   * `summary` / `firstUserMessage` everywhere the session title is shown.
   * Persisted server-side in `session_names`; `null`/absent means the
   * session has never been explicitly renamed.
   */
  customName?: string | null;
  firstUserMessage?: string;
  lastMessageRole?: 'user' | 'assistant' | null;
  name?: string;
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  __provider?: LLMProvider;
  __projectName?: string;
  /**
   * Client-only flag on synthetic sidebar rows that stand in for a new
   * session while its real id is still being minted by the server.
   */
  __pending?: boolean;
  [key: string]: unknown;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Project {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  sessions?: ProjectSession[];
  cursorSessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  geminiSessions?: ProjectSession[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
}

export interface LoadingProgress {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  changedFile?: string;
  [key: string]: unknown;
}

export interface LoadingProgressMessage extends LoadingProgress {
  type: 'loading_progress';
}

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | { type?: string;[key: string]: unknown };
