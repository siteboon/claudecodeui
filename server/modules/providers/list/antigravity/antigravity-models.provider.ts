import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderModelOption,
} from '@/shared/types.js';
import { buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/**
 * Curated Antigravity catalog.
 *
 * `agy models` publishes one id per family *and effort tier*
 * (`gemini-4-hydrogen-high`, …). That list is not what the picker should show:
 * the composer already has a separate Reasoning selector, so this catalog
 * lists each family once and declares the effort tiers as `effort.values`.
 * The runtime recombines the two into the `--model` id agy expects, which is
 * also why the app's effort axis and agy's tiers stay in step.
 *
 * `gemini-pro-orchestrator` (three flavours) and `gpt-oss-120b` have no effort
 * tiers; a model without `effort` gets no Reasoning section in the composer.
 */

const LOW_MEDIUM_HIGH = {
  default: 'medium',
  values: [
    { value: 'low' },
    { value: 'medium' },
    { value: 'high' },
  ],
};

const LOW_MEDIUM_HIGH_XHIGH = {
  default: 'medium',
  values: [
    { value: 'low' },
    { value: 'medium' },
    { value: 'high' },
    { value: 'xhigh' },
  ],
};

const model = (
  value: string,
  label: string,
  description: string,
  effort?: ProviderModelOption['effort'],
): ProviderModelOption => ({ value, label, description, ...(effort ? { effort } : {}) });

export const ANTIGRAVITY_DEFAULT_MODEL = 'gemini-4-hydrogen';

export const ANTIGRAVITY_PREDEFINED_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    model('gemini-4-hydrogen', 'Gemini 4 Hydrogen', 'Fast tier for everyday coding turns.', LOW_MEDIUM_HIGH_XHIGH),
    model('gemini-4-carbon', 'Gemini 4 Carbon', 'Balanced tier for planning and implementation.', LOW_MEDIUM_HIGH),
    model('gemini-4-argon', 'Gemini 4 Argon', 'Stronger tier for design and world knowledge.', LOW_MEDIUM_HIGH),
    model('gemini-4-neon', 'Gemini 4 Neon', 'Top tier for hard reasoning.', LOW_MEDIUM_HIGH_XHIGH),
    model('gemini-3.8-flash', 'Gemini 3.8 Flash', 'Cheapest, lowest-latency tier.', LOW_MEDIUM_HIGH),
    model('gemini-pro-orchestrator', 'Orchestrator (Carbon)', 'Pro orchestration agent, Carbon flavour.'),
    model('gemini-pro-orchestrator-argon', 'Orchestrator (Argon)', 'Pro orchestration agent, Argon flavour.'),
    model('gemini-pro-orchestrator-neon', 'Orchestrator (Neon)', 'Pro orchestration agent, Neon flavour.'),
    model('claude-opus-5-5', 'Claude Opus 5.5', 'Anthropic model served through Antigravity.', LOW_MEDIUM_HIGH),
    model('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'Anthropic model served through Antigravity.', LOW_MEDIUM_HIGH),
    model('gpt-oss-120b', 'GPT-OSS 120B', 'Open-weight model served through Antigravity.'),
  ],
  DEFAULT: ANTIGRAVITY_DEFAULT_MODEL,
};

/**
 * The model id agy expects for one family at one effort tier.
 *
 * Families agy publishes with a tier suffix take `<family>-<effort>`; the ones
 * published without tiers are passed through untouched, and `default` means
 * "let agy pick", which is the bare family id.
 */
export function resolveAntigravityModelId(family: string, effort?: string | null): string {
  const base = family.trim();
  if (!base) {
    return ANTIGRAVITY_DEFAULT_MODEL;
  }
  const option = ANTIGRAVITY_PREDEFINED_MODELS.OPTIONS.find((entry) => entry.value === base);
  const tiers = option?.effort?.values.map((value) => value.value) ?? [];
  if (!effort || effort === 'default' || tiers.length === 0 || !tiers.includes(effort)) {
    return base;
  }
  return `${base}-${effort}`;
}

export class AntigravityProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    return ANTIGRAVITY_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    // agy records the model per conversation inside its protobuf store, which
    // this app does not decode; the catalog default is the documented fallback.
    return buildDefaultProviderCurrentActiveModel(ANTIGRAVITY_PREDEFINED_MODELS);
  }
}
