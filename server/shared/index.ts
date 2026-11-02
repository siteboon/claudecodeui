export { appendFilesInputTag, buildCodexInputItems, normalizeImageDescriptors } from './image-attachments.js';
export { createCompleteMessage, createNormalizedMessage } from './utils.js';
export type { AnyRecord, ProviderRuntimeContext, ProviderRuntimeWriter } from './types.js';

// Providers' Antigravity auth/model adapters consume the shared CLI contracts.
export type { IProviderAuth, IProviderModels } from './interfaces.js';
export type { CliVersionProbe, ProviderAuthStatus, ProviderCurrentActiveModel, ProviderModelsDefinition } from './types.js';
export {
  buildDefaultProviderCurrentActiveModel,
  buildProviderCliEnv,
  parseIncomingJsonObject,
  probeCliVersion,
  resolveConfiguredCliExecutable,
  runProviderCliCommand,
  stripAnsiSequences,
  stripAntigravityTags,
} from './utils.js';
