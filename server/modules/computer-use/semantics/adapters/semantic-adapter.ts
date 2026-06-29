import type { SemanticApp, SemanticAppState, SemanticToolInput } from '@/modules/computer-use/semantics/semantic-types.js';

export type SemanticAdapterCapabilities = {
  platform: NodeJS.Platform;
  appDiscovery: boolean;
  accessibilityTree: boolean;
  nativeElementActions: boolean;
  nativeValueSetting: boolean;
  targetedInput: boolean;
};

export type SemanticAdapter = {
  capabilities(): SemanticAdapterCapabilities;
  listApps(): Promise<SemanticApp[]>;
  getAppState(input: SemanticToolInput): Promise<SemanticAppState>;
  clickElement(input: SemanticToolInput): Promise<SemanticAppState>;
  performSecondaryAction(input: SemanticToolInput): Promise<SemanticAppState>;
  setValue(input: SemanticToolInput): Promise<SemanticAppState>;
  typeText(input: SemanticToolInput): Promise<SemanticAppState>;
  pressKey(input: SemanticToolInput): Promise<SemanticAppState>;
  scrollElement(input: SemanticToolInput): Promise<SemanticAppState>;
  drag(input: SemanticToolInput): Promise<SemanticAppState>;
};
