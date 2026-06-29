import { SemanticHelperProcess } from '@/modules/computer-use/semantics/helpers/semantic-helper-process.js';
import { resolveSemanticHelper } from '@/modules/computer-use/semantics/helpers/semantic-helper-resolver.js';
import type { SemanticAdapter, SemanticAdapterCapabilities } from '@/modules/computer-use/semantics/adapters/semantic-adapter.js';
import type { SemanticApp, SemanticAppState, SemanticToolInput } from '@/modules/computer-use/semantics/semantic-types.js';

type HelperMethod =
  | 'list_apps'
  | 'get_app_state'
  | 'click_element'
  | 'perform_secondary_action'
  | 'set_value'
  | 'type_text'
  | 'press_key'
  | 'scroll_element'
  | 'drag';

export class HelperSemanticAdapter implements SemanticAdapter {
  private helper: SemanticHelperProcess | null = null;

  constructor(
    private readonly platform: NodeJS.Platform,
    private readonly arch: NodeJS.Architecture = process.arch,
  ) {}

  capabilities(): SemanticAdapterCapabilities {
    return {
      platform: this.platform,
      appDiscovery: true,
      accessibilityTree: true,
      nativeElementActions: true,
      nativeValueSetting: true,
      targetedInput: true,
    };
  }

  async listApps(): Promise<SemanticApp[]> {
    return await this.request('list_apps', {}) as SemanticApp[];
  }

  async getAppState(input: SemanticToolInput): Promise<SemanticAppState> {
    return await this.request('get_app_state', input) as SemanticAppState;
  }

  async clickElement(input: SemanticToolInput): Promise<SemanticAppState> {
    return await this.request('click_element', input) as SemanticAppState;
  }

  async performSecondaryAction(input: SemanticToolInput): Promise<SemanticAppState> {
    return await this.request('perform_secondary_action', input) as SemanticAppState;
  }

  async setValue(input: SemanticToolInput): Promise<SemanticAppState> {
    return await this.request('set_value', input) as SemanticAppState;
  }

  async typeText(input: SemanticToolInput): Promise<SemanticAppState> {
    return await this.request('type_text', input) as SemanticAppState;
  }

  async pressKey(input: SemanticToolInput): Promise<SemanticAppState> {
    return await this.request('press_key', input) as SemanticAppState;
  }

  async scrollElement(input: SemanticToolInput): Promise<SemanticAppState> {
    return await this.request('scroll_element', input) as SemanticAppState;
  }

  async drag(input: SemanticToolInput): Promise<SemanticAppState> {
    return await this.request('drag', input) as SemanticAppState;
  }

  private async request(method: HelperMethod, params: Record<string, unknown>): Promise<unknown> {
    if (!this.helper) {
      const resolution = resolveSemanticHelper(this.platform, this.arch);
      if (!resolution.available || !resolution.path) {
        throw new Error(resolution.reason || `Semantic helper is unavailable for ${this.platform}-${this.arch}.`);
      }
      this.helper = new SemanticHelperProcess(resolution.path);
    }
    return this.helper.request(method, params);
  }
}
