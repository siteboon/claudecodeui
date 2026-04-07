import type { LLMProvider } from '@/shared/types/app.js';
import { AppError } from '@/shared/utils/app-error.js';
import { llmProviderRegistry } from '@/modules/ai-runtime/ai-runtime.registry.js';
import type {
  ProviderModel,
  ProviderSessionSnapshot,
  RuntimePermissionMode,
  StartSessionInput,
} from '@/modules/ai-runtime/types/index.js';

/**
 * Converts unknown request values into optional trimmed strings.
 */
const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
};

/**
 * Validates and normalizes optional image path arrays.
 */
const normalizeImagePaths = (value: unknown): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new AppError('imagePaths must be an array of strings.', {
      code: 'INVALID_IMAGE_PATHS',
      statusCode: 400,
    });
  }

  const normalizedPaths = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);

  if (normalizedPaths.length !== value.length) {
    throw new AppError('imagePaths must contain non-empty strings only.', {
      code: 'INVALID_IMAGE_PATHS',
      statusCode: 400,
    });
  }

  return normalizedPaths;
};

/**
 * Validates and normalizes runtime permission mode.
 */
const normalizePermissionMode = (value: unknown): RuntimePermissionMode | undefined => {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    return undefined;
  }

  if (normalized === 'ask' || normalized === 'allow' || normalized === 'deny') {
    return normalized;
  }

  throw new AppError(`Unsupported runtimePermissionMode "${normalized}".`, {
    code: 'INVALID_RUNTIME_PERMISSION_MODE',
    statusCode: 400,
  });
};

/**
 * Facade over provider implementations with payload validation and capability checks.
 */
export const llmService = {
  listProviders(): Array<{
    id: LLMProvider;
    family: 'sdk' | 'cli';
    capabilities: {
      supportsRuntimePermissionRequests: boolean;
      supportsThinkingModeControl: boolean;
    };
  }> {
    return llmProviderRegistry.listProviders().map((provider) => ({
      id: provider.id,
      family: provider.family,
      capabilities: {
        supportsRuntimePermissionRequests: provider.capabilities.supportsRuntimePermissionRequests,
        supportsThinkingModeControl: provider.capabilities.supportsThinkingModeControl,
      },
    }));
  },

  async listModels(providerName: string): Promise<ProviderModel[]> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.listModels();
  },

  listSessions(providerName: string): ProviderSessionSnapshot[] {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.listSessions();
  },

  getSession(providerName: string, sessionId: string): ProviderSessionSnapshot | null {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.getSession(sessionId);
  },

  async startSession(providerName: string, payload: unknown): Promise<ProviderSessionSnapshot> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    const input = parseStartPayload(payload);
    validateCapabilityContracts(provider.capabilities, input);
    return provider.launchSession(input);
  },

  async resumeSession(
    providerName: string,
    sessionId: string,
    payload: unknown,
  ): Promise<ProviderSessionSnapshot> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    const input = parseStartPayload(payload);
    validateCapabilityContracts(provider.capabilities, input);
    return provider.resumeSession({ ...input, sessionId });
  },

  async stopSession(providerName: string, sessionId: string): Promise<boolean> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.stopSession(sessionId);
  },
};

/**
 * Parses and validates session start/resume request payloads.
 */
function parseStartPayload(payload: unknown): StartSessionInput {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('Request body must be an object.', {
      code: 'INVALID_REQUEST_BODY',
      statusCode: 400,
    });
  }

  const body = payload as Record<string, unknown>;
  const prompt = normalizeOptionalString(body.prompt);
  if (!prompt) {
    throw new AppError('prompt is required.', {
      code: 'PROMPT_REQUIRED',
      statusCode: 400,
    });
  }

  return {
    prompt,
    workspacePath: normalizeOptionalString(body.workspacePath),
    sessionId: normalizeOptionalString(body.sessionId),
    model: normalizeOptionalString(body.model),
    thinkingMode: normalizeOptionalString(body.thinkingMode),
    imagePaths: normalizeImagePaths(body.imagePaths),
    runtimePermissionMode: normalizePermissionMode(body.runtimePermissionMode),
    allowYolo: body.allowYolo === true,
  };
}

/**
 * Enforces capability contracts before provider invocation.
 */
function validateCapabilityContracts(
  capabilities: {
    supportsRuntimePermissionRequests: boolean;
    supportsThinkingModeControl: boolean;
  },
  input: StartSessionInput,
): void {
  if (
    input.runtimePermissionMode &&
    input.runtimePermissionMode !== 'ask' &&
    !capabilities.supportsRuntimePermissionRequests
  ) {
    throw new AppError('Runtime permission requests are not supported by this provider.', {
      code: 'RUNTIME_PERMISSION_NOT_SUPPORTED',
      statusCode: 400,
    });
  }

  if (input.thinkingMode && !capabilities.supportsThinkingModeControl) {
    throw new AppError('Thinking mode is not supported by this provider.', {
      code: 'THINKING_MODE_NOT_SUPPORTED',
      statusCode: 400,
    });
  }
}
