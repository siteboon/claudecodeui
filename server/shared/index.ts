export { appendFilesInputTag, buildCodexInputItems, normalizeImageDescriptors } from './image-attachments.js';
export { createCompleteMessage, createNormalizedMessage } from './utils.js';
export type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from './types.js';

// Database and Providers share the persisted session-pin summary contract.
export type { SessionPinRecord } from './types.js';
// Providers uses these shared request payloads, validators and response helpers.
export type { CustomProviderModelEffort, CustomProviderModelInput, LLMProvider, McpScope, McpTransport, ProviderSkillCreateFile, ProviderSkillCreateInput, UpsertProviderMcpServerInput } from './types.js';
export { AppError, asyncHandler, createApiSuccessResponse, SIDE_QUESTION_ID_PATTERN } from './utils.js';

// Providers uses the shared history and runtime summary contracts through this barrel.
export type { BackgroundTaskSummary, ClearedContextSegment, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage, WorkflowAgentActivity } from './types.js';
export { sliceTailPage } from './utils.js';

// Session persistence uses canonical path normalization and fork/history metadata.
export { normalizeProjectPath } from './utils.js';
export type { SessionForkAncestor } from './types.js';
