import { BaseCliProvider } from '@/modules/llm/providers/base-cli.provider.js';
import type {
  IProviderMcpRuntime,
  IProviderSkillsRuntime,
  ProviderModel,
  StartSessionInput,
} from '@/modules/llm/providers/provider.interface.js';
import { CursorMcpRuntime } from '@/modules/llm/providers/runtimes/cursor-mcp.runtime.js';
import { CursorSkillsRuntime } from '@/modules/llm/providers/runtimes/cursor-skills.runtime.js';

type CursorExecutionInput = StartSessionInput & {
  sessionId: string;
  isResume: boolean;
};

const ANSI_REGEX =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping.
  /\u001b\[[0-9;]*m/g;

/**
 * Cursor CLI provider implementation.
 */
export class CursorProvider extends BaseCliProvider {
  readonly mcp: IProviderMcpRuntime = new CursorMcpRuntime();
  readonly skills: IProviderSkillsRuntime = new CursorSkillsRuntime();

  constructor() {
    super('cursor', {
      supportsRuntimePermissionRequests: false,
      supportsThinkingModeControl: false,
    });
  }

  /**
   * Lists cursor models by parsing `cursor-agent --list-models`.
   */
  async listModels(): Promise<ProviderModel[]> {
    const output = await this.runCommandForOutput('cursor-agent', ['--list-models']);
    return this.parseModelsOutput(output);
  }

  /**
   * Creates the command invocation for cursor start/resume flows.
   */
  protected createCliInvocation(input: CursorExecutionInput): {
    command: string;
    args: string[];
    cwd?: string;
  } {
    const promptWithImagePaths = this.appendImagePathsToPrompt(input.prompt, input.imagePaths);
    const args = ['--print', '--trust', '--output-format', 'stream-json'];

    if (input.allowYolo) {
      args.push('--yolo');
    }

    if (input.model) {
      args.push('--model', input.model);
    }

    if (input.isResume) {
      args.push('--resume', input.sessionId);
    }

    args.push(promptWithImagePaths);

    return {
      command: 'cursor-agent',
      args,
      cwd: input.workspacePath,
    };
  }

  /**
   * Parses full model-list output into normalized model entries.
   */
  private parseModelsOutput(output: string): ProviderModel[] {
    const models: ProviderModel[] = [];
    const lines = output.replace(ANSI_REGEX, '').split(/\r?\n/);

    for (const line of lines) {
      const parsed = this.parseModelLine(line);
      if (!parsed) {
        continue;
      }
      models.push(parsed);
    }

    return models;
  }

  /**
   * Parses one cursor model line.
   */
  private parseModelLine(line: string): ProviderModel | null {
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed === 'Available models' ||
      trimmed.startsWith('Loading models') ||
      trimmed.startsWith('Tip:')
    ) {
      return null;
    }

    const match = trimmed.match(/^(.+?)\s+-\s+(.+)$/);
    if (!match) {
      return null;
    }

    const value = match[1].trim();
    const descriptionRaw = match[2].trim();

    const current = /\(current\)/i.test(descriptionRaw);
    const defaultModel = /\(default\)/i.test(descriptionRaw);
    const description = descriptionRaw
      .replace(/\s*\((current|default)\)/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return {
      value,
      displayName: value,
      description,
      current,
      default: defaultModel,
      supportsThinkingModes: false,
      supportedThinkingModes: [],
    };
  }
}
