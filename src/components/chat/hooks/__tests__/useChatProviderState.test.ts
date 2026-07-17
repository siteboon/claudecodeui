import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reconcileProviderModel,
  type ModelReconcileStorage,
} from '../reconcileProviderModel';
import type { LLMProvider, ProviderModelsDefinition } from '../../../../types/app';

// The reconcile effect in useChatProviderState delegates its per-provider body
// to reconcileProviderModel (the same call the effect makes, minus the React
// setter which only touches component state). Driving that function directly
// exercises the sessionScopedModelRef + persist interaction without a DOM, so
// the regression is covered with the repo's node:test convention rather than a
// jsdom/@testing-library render harness.

// Every provider gets the same OPTIONS shape (default / M2 / M3) so the same
// scenario can be parametrized across all four instead of only covering claude.
function catalogFor(): ProviderModelsDefinition {
  return {
    OPTIONS: [
      { value: 'default', label: 'Default' },
      { value: 'M2', label: 'Model 2' },
      { value: 'M3', label: 'Model 3' },
    ],
    DEFAULT: 'default',
  };
}

// A catalog that no longer offers M2, standing in for the session-scoped model
// falling out of the available options (a genuine divergence).
function catalogWithoutM2(): ProviderModelsDefinition {
  return {
    OPTIONS: [
      { value: 'default', label: 'Default' },
      { value: 'M3', label: 'Model 3' },
    ],
    DEFAULT: 'default',
  };
}

const PROVIDERS: LLMProvider[] = ['claude', 'cursor', 'codex', 'opencode'];

const STORAGE_KEY_BY_PROVIDER: Record<LLMProvider, string> = {
  claude: 'claude-model',
  cursor: 'cursor-model',
  codex: 'codex-model',
  opencode: 'opencode-model',
};

function makeStorage(initial: Record<string, string> = {}): ModelReconcileStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

for (const targetProvider of PROVIDERS) {
  const storageKey = STORAGE_KEY_BY_PROVIDER[targetProvider];

  test(
    `does not leak a session-scoped model switch for ${targetProvider} into the persisted default across unrelated reconcile re-runs, but persists a genuine default change`,
    () => {
      const storage = makeStorage();
      const catalog = catalogFor();
      // Mirrors sessionScopedModelRef.current in the hook.
      const sessionScoped: Partial<Record<LLMProvider, string>> = {};

      const reconcile = (current: string, def = catalog) =>
        reconcileProviderModel({
          storage,
          storageKey,
          current,
          catalog: def,
          sessionScoped,
          targetProvider,
        });

      // Initial reconcile with the fallback default persists the default.
      const initial = reconcile('default');
      assert.equal(initial.next, 'default');
      const initialStored = storage.getItem(storageKey);
      assert.equal(initialStored, 'default');

      // 1. A session-scoped switch occurs: setProviderModelState records the
      // model in the ref and applies it to state. The next reconcile (current
      // is now 'M2') must NOT persist it as the provider-level default.
      sessionScoped[targetProvider] = 'M2';
      const afterSwitch = reconcile('M2');
      assert.equal(afterSwitch.next, 'M2');
      assert.equal(storage.getItem(storageKey), initialStored);
      assert.notEqual(storage.getItem(storageKey), 'M2');

      // 2. An unrelated reconcile re-fire (another provider's model changed, or
      // the catalog identity changed) runs the effect body again for this
      // provider with the same current + ref still set. This is the case the
      // naive "delete-on-match" version leaked on: the persist must STILL be
      // suppressed and the ref entry preserved.
      const afterUnrelated = reconcile('M2');
      assert.equal(afterUnrelated.next, 'M2');
      assert.equal(storage.getItem(storageKey), initialStored);
      assert.notEqual(storage.getItem(storageKey), 'M2');
      assert.equal(sessionScoped[targetProvider], 'M2');

      // A third re-fire for good measure — suppression is durable, not
      // one-shot.
      reconcile('M2');
      assert.equal(storage.getItem(storageKey), initialStored);
      assert.equal(sessionScoped[targetProvider], 'M2');

      // 3a. Genuine divergence via a real default change: the user picks a new
      // default through the pre-session picker (scope: 'default'), which
      // persists 'M3' directly and leaves the ref untouched. The next reconcile
      // sees current 'M3' != ref 'M2', so it clears the ref and 'M3' sticks.
      storage.setItem(storageKey, 'M3');
      const afterRealChange = reconcile('M3');
      assert.equal(afterRealChange.next, 'M3');
      assert.equal(sessionScoped[targetProvider], undefined);
      assert.equal(storage.getItem(storageKey), 'M3');
    },
  );

  test(
    `persists a genuine default change for ${targetProvider} when the session-scoped model falls out of the catalog`,
    () => {
      const storage = makeStorage({ [storageKey]: 'default' });
      const sessionScoped: Partial<Record<LLMProvider, string>> = {};

      // Session-scoped switch to M2, suppressed as before.
      sessionScoped[targetProvider] = 'M2';
      reconcileProviderModel({
        storage,
        storageKey,
        current: 'M2',
        catalog: catalogFor(),
        sessionScoped,
        targetProvider,
      });
      assert.equal(storage.getItem(storageKey), 'default');
      assert.equal(sessionScoped[targetProvider], 'M2');

      // The catalog refreshes and no longer offers M2. pickStoredOrCurrent
      // falls back to the catalog default, which diverges from the ref: the ref
      // clears and the resolved default persists.
      const result = reconcileProviderModel({
        storage,
        storageKey,
        current: 'M2',
        catalog: catalogWithoutM2(),
        sessionScoped,
        targetProvider,
      });
      assert.equal(result.next, 'default');
      assert.equal(sessionScoped[targetProvider], undefined);
      assert.equal(storage.getItem(storageKey), 'default');
    },
  );
}
