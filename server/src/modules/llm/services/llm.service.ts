import type { LLMProvider } from '@/shared/types/app.js';
import { AppError } from '@/shared/utils/app-error.js';
import { llmProviderRegistry } from '@/modules/llm/llm.registry.js';
import type {
  McpScope,
  ProviderMcpServer,
  ProviderModel,
  ProviderSkill,
  ProviderSessionSnapshot,
  RuntimePermissionMode,
  StartSessionInput,
  UpsertProviderMcpServerInput,
} from '@/modules/llm/providers/provider.interface.js';

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
      supportsModelSwitching: boolean;
      supportsSessionResume: boolean;
      supportsSessionStop: boolean;
    };
  }> {
    return llmProviderRegistry.listProviders().map((provider) => ({
      id: provider.id,
      family: provider.family,
      capabilities: provider.capabilities,
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

  /**
   * Lists MCP servers for one provider grouped by supported scopes.
   */
  async listProviderMcpServers(
    providerName: string,
    options?: { workspacePath?: string },
  ): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.mcp.listServers(options);
  },

  /**
   * Lists MCP servers for one provider scope.
   */
  async listProviderMcpServersForScope(
    providerName: string,
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.mcp.listServersForScope(scope, options);
  },

  /**
   * Adds or updates one provider MCP server.
   */
  async upsertProviderMcpServer(
    providerName: string,
    input: UpsertProviderMcpServerInput,
  ): Promise<ProviderMcpServer> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.mcp.upsertServer(input);
  },

  /**
   * Removes one provider MCP server.
   */
  async removeProviderMcpServer(
    providerName: string,
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.mcp.removeServer(input);
  },

  /**
   * Runs one provider MCP server probe.
   */
  async runProviderMcpServer(
    providerName: string,
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{
    provider: LLMProvider;
    name: string;
    scope: McpScope;
    transport: 'stdio' | 'http' | 'sse';
    reachable: boolean;
    statusCode?: number;
    error?: string;
  }> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.mcp.runServer(input);
  },

  /**
   * Adds one HTTP/stdio MCP server to every provider.
   */
  async addMcpServerToAllProviders(
    input: Omit<UpsertProviderMcpServerInput, 'scope'> & { scope?: Exclude<McpScope, 'local'> },
  ): Promise<Array<{ provider: LLMProvider; created: boolean; error?: string }>> {
    if (input.transport !== 'stdio' && input.transport !== 'http') {
      throw new AppError('Global MCP add supports only "stdio" and "http".', {
        code: 'INVALID_GLOBAL_MCP_TRANSPORT',
        statusCode: 400,
      });
    }

    const scope = input.scope ?? 'project';
    const results: Array<{ provider: LLMProvider; created: boolean; error?: string }> = [];
    const providers = llmProviderRegistry.listProviders();
    for (const provider of providers) {
      try {
        await provider.mcp.upsertServer({ ...input, scope });
        results.push({ provider: provider.id, created: true });
      } catch (error) {
        results.push({
          provider: provider.id,
          created: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return results;
  },

  /**
   * Lists skills for one provider.
   */
  async listProviderSkills(
    providerName: string,
    options?: { workspacePath?: string },
  ): Promise<ProviderSkill[]> {
    const provider = llmProviderRegistry.resolveProvider(providerName);
    return provider.skills.listSkills(options);
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
