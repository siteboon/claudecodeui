export { appendFilesInputTag, buildCodexInputItems, normalizeImageDescriptors } from './image-attachments.js';
export { createCompleteMessage, createNormalizedMessage } from './utils.js';
export type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from './types.js';

// Providers and Database share bounded, prompt-free runtime failure evidence.
export type { SessionRuntimeFailure } from './types.js';
// Providers combines normalized native history with durable failure notices.
export type { BackgroundTaskSummary, FetchHistoryOptions, FetchHistoryResult, LLMProvider, NormalizedMessage, WorkflowAgentActivity } from './types.js';
export { AppError, sliceTailPage } from './utils.js';

// Providers uses these contracts to answer Codex side questions outside the main turn.
export type { SideQuestionOutcome, SideQuestionRequest, SideQuestionSink } from './types.js';
