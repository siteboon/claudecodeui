import { BaseCliProvider } from '@/modules/llm/providers/base-cli.provider.js';
import type { ProviderModel, StartSessionInput } from '@/modules/llm/providers/provider.interface.js';

type GeminiExecutionInput = StartSessionInput & {
  sessionId: string;
  isResume: boolean;
};

const GEMINI_MODELS: ProviderModel[] = [
  { value: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro Preview' },
  { value: 'gemini-3-pro-preview', displayName: 'Gemini 3 Pro Preview' },
  { value: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview' },
  { value: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.0-flash-lite', displayName: 'Gemini 2.0 Flash Lite' },
  { value: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
  { value: 'gemini-2.0-pro-exp', displayName: 'Gemini 2.0 Pro Experimental' },
  { value: 'gemini-2.0-flash-thinking-exp', displayName: 'Gemini 2.0 Flash Thinking' },
];

/**
 * Gemini CLI provider implementation.
 */
export class GeminiProvider extends BaseCliProvider {
  constructor() {
    super('gemini', {
      supportsRuntimePermissionRequests: false,
      supportsThinkingModeControl: false,
      supportsModelSwitching: true,
      supportsSessionResume: true,
      supportsSessionStop: true,
    });
  }

  /**
   * Returns curated Gemini model options from the refactor doc.
   */
  async listModels(): Promise<ProviderModel[]> {
    return GEMINI_MODELS;
  }

  /**
   * Creates the command invocation for gemini start/resume flows.
   */
  protected createCliInvocation(input: GeminiExecutionInput): {
    command: string;
    args: string[];
    cwd?: string;
  } {
    const promptWithImagePaths = this.appendImagePathsToPrompt(input.prompt, input.imagePaths);
    const args = ['--prompt', promptWithImagePaths, '--output-format', 'stream-json'];

    if (input.model) {
      args.push('--model', input.model);
    }

    if (input.isResume) {
      args.push('--resume', input.sessionId);
    }

    return {
      command: 'gemini',
      args,
      cwd: input.workspacePath,
    };
  }
}
