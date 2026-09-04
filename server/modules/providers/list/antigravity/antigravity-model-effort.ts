/**
 * Antigravity Model Effort Helpers
 *
 * The Antigravity CLI encodes reasoning effort as model-id suffixes: `agy
 * models` lists `gemini-3.7-flash-high/medium/low` as separate models and has
 * no bare `gemini-3.7-flash` id. To keep the picker a short base-model list
 * plus the shared Reasoning menu, variant families with two or more tiers are
 * collapsed into base models whose effort config carries
 * `encoding: 'model-suffix'`, and spawn-time arguments are re-expanded by
 * resolveAntigravityModelArgs. Models without adjustable tiers — single-
 * variant rows (gpt-oss-120b-medium), claude passthroughs, user-defined
 * custom models — carry no effort config, so the WebUI hides the Reasoning
 * menu for them and only `default` is ever sent.
 *
 * @module antigravity-model-effort
 */

import type { ProviderModelOption } from '@/shared/types.js';

/** Effort tiers agy appends to model ids, in display order. */
export const ANTIGRAVITY_EFFORT_TIERS = ['low', 'medium', 'high'] as const;

/**
 * Standard reasoning effort descriptions shared by all antigravity models.
 */
const EFFORT_DESCRIPTIONS: Record<string, string> = {
  low: 'Faster, less detailed reasoning',
  medium: 'Balanced reasoning for most tasks',
  high: 'Maximum depth reasoning for complex tasks',
};

/** One `<modelId> <Label>` row as printed by `agy models`. */
export type AntigravityRawModelEntry = {
  value: string;
  label: string;
  description?: string;
};

/**
 * Tier set of one collapsed variant family: the tiers agy offers as id
 * suffixes and the tier used when no explicit effort was chosen.
 */
type AntigravityVariantFamily = {
  tiers: string[];
  default: string;
};

const EFFORT_SUFFIX_PATTERN = /-(low|medium|high)$/;
const LABEL_TIER_PATTERN = /\s*\((?:High|Medium|Low)\)\s*$/;

/**
 * Splits a trailing effort tier off a model id.
 *
 * `gemini-3.7-flash-medium` becomes `{ base: 'gemini-3.7-flash', effort:
 * 'medium' }`; ids without a tier suffix return the id unchanged and a null
 * effort. Ids that merely end in one of these words but are not agy variants
 * (e.g. gpt-oss-120b-medium) are treated as suffixed too — spawn-time
 * resolution keeps such ids verbatim, so they round-trip unchanged.
 */
export function splitModelEffortSuffix(modelId: string): { base: string; effort: string | null } {
  const effort = modelId.match(EFFORT_SUFFIX_PATTERN)?.[1] ?? null;
  return { base: effort ? modelId.replace(EFFORT_SUFFIX_PATTERN, '') : modelId, effort };
}

/**
 * Strips a trailing "(High)"-style tier qualifier from a display label.
 * Unrelated qualifiers such as "(Thinking)" are kept.
 */
export function stripEffortTierFromLabel(label: string): string {
  return label.replace(LABEL_TIER_PATTERN, '');
}

/**
 * Collapses suffixed model variants into base-model catalog options.
 *
 * Used by antigravity-models.provider for both the builtin fallback rows and
 * the dynamic `agy models` output.
 *
 * Entries whose id ends in an effort tier are grouped under their base id.
 * A family offering two or more tiers becomes one base-model option (label
 * and description from the first-seen variant, tier stripped from the label)
 * whose merged tier set rides on the `encoding: 'model-suffix'` effort
 * config. A single-variant family is a fixed-tier model, not an adjustable
 * one: the original row passes through verbatim with no effort config.
 * Entries without a tier suffix (claude passthroughs) also pass through
 * without effort config. Options keep first-appearance order.
 */
export function dedupeAntigravityVariantModels(
  entries: AntigravityRawModelEntry[],
): ProviderModelOption[] {
  type FamilyDraft = {
    base: string;
    label: string;
    description?: string;
    tiers: Set<string>;
    firstEntry: AntigravityRawModelEntry;
    firstSeen: number;
  };

  type Slot =
    | { firstSeen: number; family: FamilyDraft }
    | { firstSeen: number; option: ProviderModelOption };

  const familyByBase = new Map<string, FamilyDraft>();
  const slots: Slot[] = [];

  for (const entry of entries) {
    const { base, effort } = splitModelEffortSuffix(entry.value);
    if (!effort) {
      slots.push({
        firstSeen: slots.length,
        option: {
          value: entry.value,
          label: entry.label,
          description: entry.description,
        },
      });
      continue;
    }

    let draft = familyByBase.get(base);
    if (!draft) {
      draft = {
        base,
        label: stripEffortTierFromLabel(entry.label),
        description: entry.description,
        tiers: new Set<string>(),
        firstEntry: entry,
        firstSeen: slots.length,
      };
      familyByBase.set(base, draft);
      slots.push({ firstSeen: draft.firstSeen, family: draft });
    }
    draft.tiers.add(effort);
  }

  return slots
    .slice()
    .sort((a, b) => a.firstSeen - b.firstSeen)
    .map((slot) => {
      if ('option' in slot) {
        return slot.option;
      }
      // A single variant is a fixed-tier model, not an adjustable one: keep
      // the original suffixed id and label with no Reasoning options.
      if (slot.family.tiers.size < 2) {
        const entry = slot.family.firstEntry;
        return {
          value: entry.value,
          label: entry.label,
          description: entry.description,
        } satisfies ProviderModelOption;
      }
      const tiers = ANTIGRAVITY_EFFORT_TIERS.filter((tier) => slot.family.tiers.has(tier));
      return {
        value: slot.family.base,
        label: slot.family.label,
        description: slot.family.description,
        effort: {
          default: defaultTierOf(tiers),
          values: tiers.map((tier) => ({ value: tier, description: EFFORT_DESCRIPTIONS[tier] })),
          encoding: 'model-suffix',
        },
      } satisfies ProviderModelOption;
    });
}

/** Picks the preferred default tier: high, then medium, then low. */
function defaultTierOf(tiers: string[]): string {
  return tiers.find((tier) => tier === 'high')
    ?? tiers.find((tier) => tier === 'medium')
    ?? tiers.find((tier) => tier === 'low')
    ?? 'high';
}

/**
 * Extracts the variant-family tier set from a catalog option, or null when
 * the model does not encode effort in its id (fixed-tier, passthrough, and
 * custom models).
 */
function extractVariantFamilyFromOption(
  option: ProviderModelOption | undefined,
): AntigravityVariantFamily | null {
  const effort = option?.effort;
  if (!effort || effort.encoding !== 'model-suffix' || effort.values.length === 0) {
    return null;
  }

  const tiers = effort.values.map((value) => value.value);
  return {
    tiers,
    default: effort.default && tiers.includes(effort.default)
      ? effort.default
      : tiers[tiers.length - 1],
  };
}

/**
 * Resolves the `--model` / `--effort` arguments one agy run should spawn with.
 *
 * Used by antigravity-runtime.provider when building the CLI argument list;
 * `catalogOption` is the merged-catalog entry for the model's base id.
 *
 * Rules:
 * - A base id from a variant family gets the chosen tier appended to the
 *   model id (the family default tier applies when no valid effort was
 *   chosen), and a legacy suffixed id from an old session row keeps or
 *   rewrites its embedded tier within the family — the `--effort` flag is
 *   never combined with a suffixed id because the CLI rejects the run.
 * - A cataloged model without effort support (claude passthroughs, the
 *   fixed-tier gpt-oss-120b-medium) runs with its id verbatim; a stale
 *   effort choice is dropped and no model id is ever invented.
 * - A model absent from the catalog (user-defined custom models) keeps its
 *   id and receives `--effort` when a valid tier was requested.
 */
export function resolveAntigravityModelArgs(
  model: string | undefined,
  effort: string | undefined,
  catalogOption: ProviderModelOption | undefined,
): { model?: string; effort?: string } {
  const requested = effort !== undefined
    && (ANTIGRAVITY_EFFORT_TIERS as readonly string[]).includes(effort)
    ? effort
    : undefined;

  if (!model) {
    return requested ? { effort: requested } : {};
  }

  const { base, effort: embedded } = splitModelEffortSuffix(model);
  const family = extractVariantFamilyFromOption(catalogOption);

  if (embedded) {
    if (!family) {
      return { model };
    }
    let tier = embedded;
    if (requested && requested !== embedded) {
      tier = family.tiers.includes(requested) ? requested : family.default;
    }
    return { model: `${base}-${tier}` };
  }

  if (family) {
    const tier = requested && family.tiers.includes(requested) ? requested : family.default;
    return { model: `${base}-${tier}` };
  }

  if (catalogOption) {
    return { model };
  }

  return requested ? { model, effort: requested } : { model };
}
