import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import {
  discoverOllamaModels,
  resetOllamaModelCache,
} from '@/modules/providers/list/opencode/ollama-models.discovery.js';

type TagsPayload = {
  models: {
    name: string;
    details?: { parameter_size?: string; family?: string };
  }[];
};

/**
 * Serves one `/api/tags` response on a loopback port, so the discovery can be
 * exercised without an Ollama installation.
 */
async function withOllamaStub(
  payload: TagsPayload | 'broken',
  runTest: () => Promise<void>,
): Promise<void> {
  const server = http.createServer((request, response) => {
    if (!request.url?.startsWith('/api/tags')) {
      response.writeHead(404).end();
      return;
    }

    if (payload === 'broken') {
      response.writeHead(500).end();
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const previousUrl = process.env.CLOUDCLI_OLLAMA_URL;
  const previousFlag = process.env.CLOUDCLI_OLLAMA_DISCOVERY;
  process.env.CLOUDCLI_OLLAMA_URL = `http://127.0.0.1:${port}`;
  delete process.env.CLOUDCLI_OLLAMA_DISCOVERY;
  resetOllamaModelCache();

  try {
    await runTest();
  } finally {
    resetOllamaModelCache();
    if (previousUrl === undefined) {
      delete process.env.CLOUDCLI_OLLAMA_URL;
    } else {
      process.env.CLOUDCLI_OLLAMA_URL = previousUrl;
    }
    if (previousFlag === undefined) {
      delete process.env.CLOUDCLI_OLLAMA_DISCOVERY;
    } else {
      process.env.CLOUDCLI_OLLAMA_DISCOVERY = previousFlag;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('discoverOllamaModels prefixes, labels and sorts what Ollama reports', async () => {
  await withOllamaStub(
    {
      models: [
        { name: 'qwen3:27b', details: { parameter_size: '27.3B', family: 'qwen3' } },
        { name: 'gemma:26b', details: { parameter_size: '25.2B', family: 'gemma' } },
      ],
    },
    async () => {
      const models = await discoverOllamaModels();

      assert.deepEqual(models, [
        { value: 'ollama/gemma:26b', label: 'gemma:26b (25.2B)', description: 'Ollama, local' },
        { value: 'ollama/qwen3:27b', label: 'qwen3:27b (27.3B)', description: 'Ollama, local' },
      ]);
    },
  );
});

test('discoverOllamaModels leaves out embedding models', async () => {
  await withOllamaStub(
    {
      models: [
        { name: 'nomic-embed-text:latest', details: { family: 'nomic-bert' } },
        { name: 'mxbai-embed-large:latest', details: { family: 'bert' } },
        { name: 'qwen3:27b', details: { parameter_size: '27.3B', family: 'qwen3' } },
      ],
    },
    async () => {
      const models = await discoverOllamaModels();

      assert.deepEqual(models.map((model) => model.value), ['ollama/qwen3:27b']);
    },
  );
});

test('discoverOllamaModels yields nothing when Ollama answers with an error', async () => {
  await withOllamaStub('broken', async () => {
    assert.deepEqual(await discoverOllamaModels(), []);
  });
});

test('discoverOllamaModels yields nothing when nothing listens', async () => {
  const previousUrl = process.env.CLOUDCLI_OLLAMA_URL;
  // Port 1 is privileged and unused: the connection is refused immediately,
  // which is the case a machine without Ollama hits on every catalog read.
  process.env.CLOUDCLI_OLLAMA_URL = 'http://127.0.0.1:1';
  resetOllamaModelCache();

  try {
    const startedAt = Date.now();
    assert.deepEqual(await discoverOllamaModels(), []);
    assert.ok(
      Date.now() - startedAt < 1500,
      'a refused connection must not wait for the probe timeout',
    );
  } finally {
    resetOllamaModelCache();
    if (previousUrl === undefined) {
      delete process.env.CLOUDCLI_OLLAMA_URL;
    } else {
      process.env.CLOUDCLI_OLLAMA_URL = previousUrl;
    }
  }
});

test('discoverOllamaModels stays out of the way when discovery is switched off', async () => {
  await withOllamaStub(
    { models: [{ name: 'qwen3:27b', details: { parameter_size: '27.3B' } }] },
    async () => {
      process.env.CLOUDCLI_OLLAMA_DISCOVERY = '0';
      resetOllamaModelCache();

      assert.deepEqual(await discoverOllamaModels(), []);
    },
  );
});
