import { spawn } from 'node:child_process';

import { query, type ModelInfo, type Options } from '@anthropic-ai/claude-agent-sdk';
import crossSpawn from 'cross-spawn';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

export const CLAUDE_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    { value: 'default', label: 'Default (recommended)' },
    { value: 'sonnet[1m]', label: 'Sonnet (1M context)' },
    { value: 'opus', label: 'Opus' },
    { value: 'opus[1m]', label: 'Opus (1M context)' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'sonnet', label: 'sonnet' },
  ],
  DEFAULT: 'default',
};

type ClaudeModelQueryOptions = Pick<Options, 'env' | 'pathToClaudeCodeExecutable' | 'permissionMode'>;
type ClaudeInitEvent = {
  type?: string;
  subtype?: string;
  model?: string;
};

const CLAUDE_ACTIVE_MODEL_TIMEOUT_MS = 20_000;
const claudeSpawn = process.platform === 'win32' ? crossSpawn : spawn;

const buildClaudeQueryOptions = (): ClaudeModelQueryOptions => ({
  env: { ...process.env },
  pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
  permissionMode: 'default',
});

const mapClaudeModel = (model: ModelInfo): ProviderModelOption => ({
  value: model.value,
  label: model.displayName || model.value,
  description: model.description || undefined,
});

const buildClaudeModelsDefinition = (models: ModelInfo[]): ProviderModelsDefinition => {
  const options: ProviderModelOption[] = [];
  const seenValues = new Set<string>();

  for (const model of models) {
    const mappedModel = mapClaudeModel(model);
    if (seenValues.has(mappedModel.value)) {
      continue;
    }

    seenValues.add(mappedModel.value);
    options.push(mappedModel);
  }

  if (options.length === 0) {
    return CLAUDE_FALLBACK_MODELS;
  }

  const defaultValue = options.find((option) => option.value === 'default')?.value
    ?? options[0]?.value
    ?? CLAUDE_FALLBACK_MODELS.DEFAULT;

  return {
    OPTIONS: options,
    DEFAULT: defaultValue,
  };
};

const runClaudeSessionModelCommand = async (sessionId: string): Promise<ProviderCurrentActiveModel | null> => {
  const cliPath = resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH);

  return new Promise((resolve, reject) => {
    const child = claudeSpawn(
      cliPath,
      ['-p', '--verbose', '--output-format', 'stream-json', '--resume', sessionId, 'ok'],
      {
        env: { ...process.env },
        windowsHide: true,
      },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      if (!settled) {
        settled = true;
        reject(new Error('Claude current-model lookup timed out'));
      }
    }, CLAUDE_ACTIVE_MODEL_TIMEOUT_MS);

    const finish = (error: Error | null, result: ProviderCurrentActiveModel | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      finish(error instanceof Error ? error : new Error(String(error)), null);
    });

    child.on('close', () => {
      const lines = `${stdout}\n${stderr}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as ClaudeInitEvent;
          if (event.type === 'system' && event.subtype === 'init' && event.model) {
            finish(null, {
              model: event.model,
            });
            return;
          }
        } catch {
          // The Claude CLI mixes non-JSON lines into verbose output; ignore them.
        }
      }

      finish(null, null);
    });
  });
};

export class ClaudeProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    let queryInstance: ReturnType<typeof query> | null = null;

    try {
      // The SDK exposes its runtime model catalog on the initialized query
      // instance, so we create a lightweight query and immediately close it
      // after reading the control-plane metadata.
      queryInstance = query({
        prompt: '',
        options: buildClaudeQueryOptions(),
      });

      const supportedModels = await queryInstance.supportedModels();

      return buildClaudeModelsDefinition(supportedModels);
    } catch {
      return CLAUDE_FALLBACK_MODELS;
    } finally {
      queryInstance?.close();
    }
  }

  async getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel> {
    if (!sessionId?.trim()) {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }

    try {
      const activeModel = await runClaudeSessionModelCommand(sessionId);
      if (activeModel?.model) {
        return activeModel;
      }
    } catch {
      // Fall through to the provider default when the session-backed lookup fails.
    }

    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
