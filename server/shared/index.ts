export { appendFilesInputTag, buildCodexInputItems, normalizeImageDescriptors } from './image-attachments.js';

// Providers, Agent response collection, and Websocket Shell launches consume these shared contracts.
export type {
  IProviderAuth,
  IProviderFork,
  IProviderModels,
  IProviderRuntime,
  IProviderSessions,
  IProviderSessionSynchronizer,
  IProviderSkills,
} from './interfaces.js';
export type {
  AnyRecord,
  AuthenticatedWebSocketRequest,
  BackgroundTaskSummary,
  LLMProvider,
  ProviderPermissionDecision,
  WorkflowAgentActivity,
  CliVersionProbe,
  FetchHistoryOptions,
  FetchHistoryResult,
  McpScope,
  NormalizedMessage,
  ProviderAuthStatus,
  ProviderCurrentActiveModel,
  ProviderMcpServer,
  ProviderModelsDefinition,
  ProviderRunFunction,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  ProviderSkillSource,
  SideQuestion,
  SideQuestionEvent,
  SideQuestionRuntime,
  UpsertProviderMcpServerInput,
} from './types.js';
export {
  AppError,
  SIDE_QUESTION_ID_PATTERN,
  buildDefaultProviderCurrentActiveModel,
  buildLookupMap,
  extractFirstValidJsonlData,
  buildProviderCliEnv,
  createCompleteMessage,
  createNormalizedMessage,
  findFilesRecursivelyModifiedAfter,
  generateMessageId,
  normalizeProjectPath,
  normalizeSessionName,
  parseIncomingJsonObject,
  probeCliVersion,
  readFileTimestamps,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  resolveConfiguredCliExecutable,
  runProviderCliCommand,
  sanitizeLeafDirectoryName,
  sliceTailPage,
  stripAnsiSequences,
  stripAntigravityTags,
  writeJsonConfig,
} from './utils.js';

export { getLinuxFileLockIdentity, parseLinuxExclusiveFileLocks } from './utils.js';

export { getGlobalImageAssetsDir, isImageAttachmentDescriptor, normalizeAttachmentDescriptors } from './image-attachments.js';
export type { ChatAttachmentDescriptor } from './image-attachments.js';
