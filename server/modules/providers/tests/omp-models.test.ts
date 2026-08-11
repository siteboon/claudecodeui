/**
 * Unit test for the omp `omp models --json` catalog parse (P6). Pure — no exec.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseOmpModels, OMP_CONFIGURED_MODEL_SENTINEL } from '@/modules/providers/list/omp/omp-models.provider.js';

describe('parseOmpModels', () => {
  it('maps selector/name, marks thinking models with effort, sentinel first, dedupes', () => {
    // Real omp shape: `thinking` is this model's own level array, OR null.
    const json = JSON.stringify({
      models: [
        { provider: 'openai', id: 'gpt-5.2', selector: 'openai/gpt-5.2', name: 'GPT-5.2', thinking: ['minimal', 'low', 'medium', 'high'], contextWindow: 400000 },
        { provider: 'anthropic', id: 'opus', selector: 'anthropic/opus', name: 'Claude Opus', thinking: null },
        { provider: 'openai', id: 'gpt-5.2', selector: 'openai/gpt-5.2', name: 'dup' }, // duplicate selector
      ],
    });
    const def = parseOmpModels(json);

    assert.equal(def.OPTIONS[0].value, OMP_CONFIGURED_MODEL_SENTINEL, 'sentinel first');
    assert.equal(def.DEFAULT, OMP_CONFIGURED_MODEL_SENTINEL);

    const gpt = def.OPTIONS.find((o) => o.value === 'openai/gpt-5.2')!;
    assert.equal(gpt.label, 'GPT-5.2');
    assert.equal(gpt.description, 'openai/gpt-5.2');
    assert.ok(gpt.effort, 'thinking model gets effort');
    // effort levels are exactly the model's own list (not a hardcoded 7).
    assert.deepEqual(gpt.effort!.values.map((v) => v.value), ['minimal', 'low', 'medium', 'high']);

    const opus = def.OPTIONS.find((o) => o.value === 'anthropic/opus')!;
    assert.equal(opus.effort, undefined, 'non-thinking model has no effort');

    assert.equal(def.OPTIONS.filter((o) => o.value === 'openai/gpt-5.2').length, 1, 'deduped');
  });

  it('falls back to sentinel-only on empty catalog', () => {
    assert.deepEqual(parseOmpModels('{"models":[]}').OPTIONS.map((o) => o.value), [OMP_CONFIGURED_MODEL_SENTINEL]);
  });
});
