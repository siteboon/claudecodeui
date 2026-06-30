import type { LLMProvider, ProviderModelOption } from '../../../types/app';

export const DEFAULT_EFFORT_VALUE = 'default';

export const FALLBACK_PROVIDER_EFFORT_VALUES: Partial<Record<LLMProvider, readonly string[]>> = {
  claude: ['low', 'medium', 'high', 'xhigh', 'max'],
  codex: ['low', 'medium', 'high', 'xhigh'],
};

export const toProviderEffortOptions = (
  values: readonly string[],
): NonNullable<ProviderModelOption['effort']>['values'] => values.map((value) => ({ value }));
