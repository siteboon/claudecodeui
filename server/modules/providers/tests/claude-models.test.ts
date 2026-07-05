import assert from 'node:assert/strict';
import test from 'node:test';

import { ClaudeProviderModels } from '@/modules/providers/list/claude/claude-models.provider.js';

test('Claude models provider merges custom model list from environment', async () => {
  const previousModels = process.env.CLOUDCLI_CLAUDE_MODELS;
  const previousDefault = process.env.CLOUDCLI_CLAUDE_DEFAULT_MODEL;

  try {
    process.env.CLOUDCLI_CLAUDE_MODELS = JSON.stringify([
      {
        value: 'gateway/claude-custom',
        label: 'Gateway Claude Custom',
        description: 'Custom gateway model',
      },
    ]);
    process.env.CLOUDCLI_CLAUDE_DEFAULT_MODEL = 'gateway/claude-custom';

    const provider = new ClaudeProviderModels();
    const models = await provider.getSupportedModels();

    assert.ok(models.OPTIONS.some((option) => option.value === 'default'));
    assert.deepEqual(
      models.OPTIONS.find((option) => option.value === 'gateway/claude-custom'),
      {
        value: 'gateway/claude-custom',
        label: 'Gateway Claude Custom',
        description: 'Custom gateway model',
      },
    );
    assert.equal(models.DEFAULT, 'gateway/claude-custom');
  } finally {
    if (previousModels === undefined) {
      delete process.env.CLOUDCLI_CLAUDE_MODELS;
    } else {
      process.env.CLOUDCLI_CLAUDE_MODELS = previousModels;
    }

    if (previousDefault === undefined) {
      delete process.env.CLOUDCLI_CLAUDE_DEFAULT_MODEL;
    } else {
      process.env.CLOUDCLI_CLAUDE_DEFAULT_MODEL = previousDefault;
    }
  }
});
