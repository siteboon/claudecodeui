import type { LLMProvider } from '@/shared/types/app.js';

export type ProviderExecutionFamily = 'sdk' | 'cli';

export type ProviderSessionStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type RuntimePermissionMode = 'ask' | 'allow' | 'deny';

/**
 * Advertises optional provider behaviors so route/service code can gate features.
 */
export type ProviderCapabilities = {
  supportsRuntimePermissionRequests: boolean;
  supportsThinkingModeControl: boolean;
  supportsModelSwitching: boolean;
  supportsSessionResume: boolean;
  supportsSessionStop: boolean;
};

/**
 * Provider model descriptor normalized for frontend consumption.
 */
export type ProviderModel = {
  value: string;
  displayName: string;
  description?: string;
  default?: boolean;
  current?: boolean;
  supportsThinkingModes?: boolean;
  supportedThinkingModes?: string[];
};

/**
 * Unified in-memory event emitted while a provider session runs.
 */
export type ProviderSessionEvent = {
  timestamp: string;
  channel: 'sdk' | 'stdout' | 'stderr' | 'json' | 'system' | 'error';
  message?: string;
  data?: unknown;
};

/**
 * Common launch/resume payload consumed by all providers.
 */
export type StartSessionInput = {
  prompt: string;
  workspacePath?: string;
  sessionId?: string;
  model?: string;
  thinkingMode?: string;
  imagePaths?: string[];
  runtimePermissionMode?: RuntimePermissionMode;
  allowYolo?: boolean;
};

/**
 * Snapshot shape exposed externally for a provider session.
 */
export type ProviderSessionSnapshot = {
  sessionId: string;
  provider: LLMProvider;
  family: ProviderExecutionFamily;
  status: ProviderSessionStatus;
  startedAt: string;
  endedAt?: string;
  model?: string;
  thinkingMode?: string;
  events: ProviderSessionEvent[];
  error?: string;
};

/**
 * Provider contract that both SDK and CLI families implement.
 */
export interface IProvider {
  readonly id: LLMProvider;
  readonly family: ProviderExecutionFamily;
  readonly capabilities: ProviderCapabilities;

  listModels(): Promise<ProviderModel[]>;

  launchSession(input: StartSessionInput): Promise<ProviderSessionSnapshot>;
  resumeSession(input: StartSessionInput & { sessionId: string }): Promise<ProviderSessionSnapshot>;

  stopSession(sessionId: string): Promise<boolean>;

  getSession(sessionId: string): ProviderSessionSnapshot | null;
  listSessions(): ProviderSessionSnapshot[];
}

/**
 * Internal mutable session state used by provider base classes.
 */
export type MutableProviderSession = Omit<ProviderSessionSnapshot, 'events'> & {
  events: ProviderSessionEvent[];
  completion: Promise<void>;
  stop: () => Promise<boolean>;
};
