import assert from 'node:assert/strict';
import test from 'node:test';

import { parseQoderModelsStdout } from '@/modules/providers/list/qoder/qoder-models.provider.js';

/**
 * Captured verbatim from `qodercli --list-models` (v1.1.13). The first row is
 * a literal `MODEL` header, not a model id.
 */
const REAL_LIST_MODELS_OUTPUT = `MODEL
Auto
Ultimate
Performance
Efficient
Lite
Cantus
Qwen3.8-Max
Qwen3.7-Max
Qwen3.7-Plus
Kimi-K3
Kimi-K2.7-Code
GLM-5.2
DeepSeek-V4-Pro
DeepSeek-V4-Flash
MiniMax-M3
Peach-07-17-DogFooding (qwen3.8-max-preview)
`;

test('Qoder models parser skips the MODEL header row from real CLI output', () => {
  const ids = parseQoderModelsStdout(REAL_LIST_MODELS_OUTPUT);

  assert.equal(ids.includes('MODEL'), false);
  assert.deepEqual(ids[0], 'Auto');
  assert.deepEqual(ids[1], 'Ultimate');
  assert.equal(ids.length, 16);
});

test('Qoder models parser removes duplicates and ignores JSON fragments', () => {
  const ids = parseQoderModelsStdout(`MODEL
Auto
Auto
{"warning": "beta"}
[debug]
Ultimate
`);

  assert.deepEqual(ids, ['Auto', 'Ultimate']);
});

test('Qoder models parser handles CRLF line endings and blank lines', () => {
  const ids = parseQoderModelsStdout('MODEL\r\nAuto\r\n\r\n  Ultimate  \r\n');

  assert.deepEqual(ids, ['Auto', 'Ultimate']);
});

test('Qoder models parser returns empty list for header-only output', () => {
  assert.deepEqual(parseQoderModelsStdout('MODEL\n'), []);
});
