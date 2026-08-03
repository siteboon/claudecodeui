/**
 * PiModelsProvider - Pi model catalog facet (IProviderModels).
 *
 * Resolves the catalog from a Pi RPC probe: `getAvailableModels()` supplies the
 * selectable models and `getState().model` supplies the default. Models are
 * exposed with the canonical `<upstream-provider>/<model-id>` value; only models
 * that report `reasoning: true` expose thinking effort levels.
 *
 * The probe is treated as an authentication signal: a probe that throws or
 * returns no models is surfaced as `PI_NOT_AUTHENTICATED` rather than a fake
 * empty catalog, so callers never mistake "not authenticated" for "success".
 */
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { AppError, buildDefaultProviderCurrentActiveModel } from '@/shared/utils.js';

/** One model row as returned by the Pi RPC `get_available_models` call. */
export type PiModelRow = {
  provider: string;
  id: string;
  contextWindow: number;
  reasoning: boolean;
};

/** Minimal probe surface consumed to build the catalog. */
export interface PiModelsProbe {
  getAvailableModels(): Promise<PiModelRow[]>;
  getState(): Promise<{ model?: string }>;
}

/**
 * Runs `fn` against a started Pi RPC probe, handling lifecycle. Tests inject a
 * stub that resolves against an in-memory probe without spawning a process.
 */
export interface PiModelsRpc {
  withProbe<T>(fn: (probe: PiModelsProbe) => Promise<T>): Promise<T>;
}

// Thinking effort levels Pi exposes for reasoning-capable models. Mirrors the
// Pi `ThinkingLevel` union (excluding the "off" no-op level).
const PI_THINKING_EFFORTS: NonNullable<ProviderModelOption['effort']>['values'] = [
  { value: 'minimal' },
  { value: 'low' },
  { value: 'medium' },
  { value: 'high' },
  { value: 'xhigh' },
  { value: 'max' },
];

const toCanonical = (row: PiModelRow): string => `${row.provider}/${row.id}`;

const mapModel = (row: PiModelRow): ProviderModelOption => ({
  value: toCanonical(row),
  label: row.id,
  description: `${row.provider} - ${toCanonical(row)}`,
  effort: row.reasoning ? { values: PI_THINKING_EFFORTS } : undefined,
});

export class PiModelsProvider implements IProviderModels {
  private readonly rpc: PiModelsRpc;

  constructor(rpc: PiModelsRpc) {
    this.rpc = rpc;
  }

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    let rows: PiModelRow[];
    let stateModel: string | undefined;

    try {
      ({ rows, stateModel } = await this.rpc.withProbe(async (probe) => ({
        rows: await probe.getAvailableModels(),
        stateModel: (await probe.getState()).model,
      })));
    } catch {
      throw new AppError('Pi 未认证', { code: 'PI_NOT_AUTHENTICATED' });
    }

    if (rows.length === 0) {
      throw new AppError('Pi 未认证', { code: 'PI_NOT_AUTHENTICATED' });
    }

    const options = rows.map(mapModel);
    const defaultValue =
      (stateModel && options.find((option) => option.value === stateModel)?.value) ??
      options[0].value;

    return {
      OPTIONS: options,
      DEFAULT: defaultValue,
    };
  }

  async getCurrentActiveModel(_sessionId?: string): Promise<ProviderCurrentActiveModel> {
    return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
  }
}
