import type { LLMProvider, ProviderModelsDefinition } from '../../../types/app';

/**
 * Minimal storage surface the reconcile logic needs. `localStorage` satisfies
 * it directly in the browser; tests pass an in-memory stand-in so the logic can
 * be exercised without a DOM.
 */
export interface ModelReconcileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// `current` wins over the stored value on purpose: this runs on every model
// change, so preferring `stored` would immediately overwrite a freshly-applied
// session-scoped model back to the last persisted default.
export function pickStoredOrCurrentModel(
  storage: ModelReconcileStorage,
  storageKey: string,
  current: string,
  def: ProviderModelsDefinition,
): string {
  if (current && def.OPTIONS.some((o) => o.value === current)) {
    return current;
  }
  const stored = storage.getItem(storageKey);
  if (stored && def.OPTIONS.some((o) => o.value === stored)) {
    return stored;
  }
  return def.DEFAULT;
}

/**
 * Per-provider body of the reconcile effect. Resolves the model that should be
 * active for `targetProvider`, and decides whether to persist it as the
 * provider-level default.
 *
 * The `sessionScoped` map records the most recent model applied via a
 * mid-session switch. While `next` still equals the recorded value, the persist
 * is suppressed and the entry is *kept* — so it survives an unrelated re-run of
 * the effect (another provider's model changing, a catalog identity change).
 * The entry is only cleared, and the value persisted, once `next` genuinely
 * diverges (a real default change, or the session-scoped model falling out of
 * the catalog).
 *
 * Returns the resolved model; the caller applies it to React state. This is a
 * pure move of the effect body so effect timing/dependencies stay unchanged.
 */
export function reconcileProviderModel(params: {
  storage: ModelReconcileStorage;
  storageKey: string;
  current: string;
  catalog: ProviderModelsDefinition;
  sessionScoped: Partial<Record<LLMProvider, string>>;
  targetProvider: LLMProvider;
}): { next: string } {
  const { storage, storageKey, current, catalog, sessionScoped, targetProvider } = params;

  const next = pickStoredOrCurrentModel(storage, storageKey, current, catalog);

  if (sessionScoped[targetProvider] === next) {
    // Still the session-scoped value from a mid-session switch — keep
    // suppressing the persist until it genuinely diverges.
    return { next };
  }
  delete sessionScoped[targetProvider];

  if (storage.getItem(storageKey) !== next) {
    storage.setItem(storageKey, next);
  }

  return { next };
}
