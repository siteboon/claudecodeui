import assert from 'node:assert/strict';
import test from 'node:test';

import { getCodexClientOptions } from './codex-runtime.provider.js';


test('Codex exec requests reasoning summaries for streamed chat turns', () => {
  assert.deepEqual(getCodexClientOptions(), {
    config: {
      model_reasoning_summary: 'detailed',
    },
  });
});
