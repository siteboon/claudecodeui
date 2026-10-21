// Run with TSX_TSCONFIG_PATH=server/tsconfig.json node
// --experimental-test-module-mocks --import tsx --test <this file>.
// The real provider wrapper, model service, settings storage and shared runtime
// execute through the SDK query boundary. Transport cases also run the SDK's
// serializer with a mock subprocess. No provider/network requests are made.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, mock, test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { query as realQuery } from '@anthropic-ai/claude-agent-sdk';

const artifactRoot = process.env.MINIMAX_TEST_ARTIFACTS || path.resolve('.test-artifacts');
await mkdir(artifactRoot, { recursive: true });
const testHome = await mkdtemp(path.join(artifactRoot, 'minimax-request-'));
mock.method(os, 'homedir', () => testHome);
const originalEnvironment = { ...process.env };
const requests = [];
const transports = [];
let useRealSdk = false;

// Replace the subprocess transport, not the SDK serializer. This fixture
// captures the actual CLI arguments and JSON control/user messages produced by
// the SDK, and responds locally without running a CLI or making HTTP requests.
function spawnFixture(options) {
  const transport = { ...options, messages: [] };
  transports.push(transport);
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => { child.killed = true; return true; };
  let buffer = '';
  const reply = (message) => child.stdout.write(`${JSON.stringify(message)}\n`);
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      buffer += chunk.toString();
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n');
        const message = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        transport.messages.push(message);
        if (message.type === 'control_request') {
          reply({ type: 'control_response', response: {
            subtype: 'success', request_id: message.request_id,
            response: { commands: [], models: [], agents: [], account: {} },
          } });
        } else if (message.type === 'user') {
          reply({ type: 'result', subtype: 'success', is_error: false,
            result: 'Hello', session_id: 'fixture-session', duration_ms: 0,
            duration_api_ms: 0, num_turns: 1, total_cost_usd: 0,
            usage: {}, modelUsage: {}, permission_denials: [], uuid: 'fixture-result' });
          setImmediate(() => {
            child.exitCode = 0;
            child.stdout.end();
            child.emit('exit', 0, null);
          });
        }
      }
      done();
    },
  });
  return child;
}

let models;
let claudeModels;
const moduleUrl = (relative) => new URL(relative, import.meta.url).href;

mock.module('@anthropic-ai/claude-agent-sdk', {
  namedExports: {
    query: (request) => {
      requests.push(JSON.parse(JSON.stringify(request)));
      if (useRealSdk) {
        return realQuery({ ...request, options: {
          ...request.options, spawnClaudeCodeProcess: spawnFixture,
        } });
      }
      return (async function* () {})();
    },
  },
});
mock.module('gray-matter', { defaultExport: () => ({ data: {}, content: '' }) });
const transcriptPaths = new Map();
mock.module(moduleUrl('../../database/index.ts'), {
  namedExports: { sessionsDb: { getSessionById: (id) => ({ jsonl_path: transcriptPaths.get(id) }) } },
});
mock.module(moduleUrl('../provider.registry.ts'), {
  namedExports: {
    providerRegistry: {
      resolveProvider: (provider) => ({
        models: provider === 'minimax' ? models : claudeModels,
      }),
    },
  },
});
mock.module(moduleUrl('../../../services/notification-orchestrator.js'), {
  namedExports: {
    createNotificationEvent: (event) => event,
    notifyRunFailed: () => {},
    notifyRunStopped: () => {},
    notifyUserIfEnabled: () => {},
  },
});
mock.module(moduleUrl('../services/sessions.service.ts'), {
  namedExports: { sessionsService: { normalizeMessage: () => [] } },
});
mock.module(moduleUrl('../services/provider-auth.service.ts'), {
  namedExports: { providerAuthService: { isProviderInstalled: async () => true } },
});

const { MINIMAX_MODELS, MiniMaxProviderModels, isMiniMaxModel, resolveMiniMaxContextWindow } =
  await import('../list/minimax/minimax-models.provider.ts');
const { ClaudeProviderModels } = await import('../list/claude/claude-models.provider.ts');
models = new MiniMaxProviderModels();
claudeModels = new ClaudeProviderModels();
const { providerModelsService } = await import('../services/provider-models.service.ts');
const { queryMiniMaxSDK } = await import('../../../minimax-sdk.ts');
const { queryClaudeSDK } = await import('../../../claude-sdk.js');

function resetEnvironment(extra = {}) {
  for (const name of Object.keys(process.env)) {
    if (/^(ANTHROPIC_|MINIMAX_|CLAUDE_)/.test(name)) delete process.env[name];
  }
  Object.assign(process.env, extra);
}

async function send(options = {}, extraEnvironment = {}, runtime = queryMiniMaxSDK) {
  resetEnvironment(extraEnvironment);
  const events = [];
  const before = requests.length;
  await runtime('Say hello', options, { send: (event) => events.push(event) });
  assert.equal(requests.length, before + 1, JSON.stringify(events));
  assert.equal(events.at(-1)?.success, true, JSON.stringify(events));
  return requests.at(-1);
}

after(() => {
  resetEnvironment();
  Object.assign(process.env, originalEnvironment);
  mock.restoreAll();
});

test('curated MiniMax choices, context, prices and legacy transcript recognition', () => {
  assert.deepEqual(MINIMAX_MODELS.OPTIONS.map(({ value }) => value), ['MiniMax-M3.1-Flash', 'MiniMax-M3']);
  assert.equal(MINIMAX_MODELS.DEFAULT, 'MiniMax-M3.1-Flash');
  assert.match(MINIMAX_MODELS.OPTIONS[0].description, /\$0\.15 input \/ \$0\.60 output/);
  assert.deepEqual(MINIMAX_MODELS.OPTIONS[0].effort.values.map(({ value }) => value), ['low', 'medium', 'high', 'xhigh', 'max']);
  for (const model of ['MiniMax-M3.1-Flash', 'MiniMax-M3']) {
    assert.equal(resolveMiniMaxContextWindow(model), 1_000_000);
    assert.equal(isMiniMaxModel(model), true);
  }
  assert.equal(resolveMiniMaxContextWindow('MiniMax-M2.7'), 204_800);
  assert.equal(isMiniMaxModel('MiniMax-M2.7[1m]'), true);
  assert.equal(isMiniMaxModel('claude-sonnet-4-6'), false);
});

test('fresh SDK request uses Flash and adaptive thinking without inherited Anthropic auth', async () => {
  const { prompt, options } = await send({}, {
    MINIMAX_API_KEY: 'fixture-minimax-key',
    ANTHROPIC_API_KEY: 'fixture-unrelated-key',
    ANTHROPIC_AUTH_TOKEN: 'fixture-unrelated-token',
  });
  assert.equal(prompt, 'Say hello');
  assert.equal(options.model, 'MiniMax-M3.1-Flash');
  assert.deepEqual(options.thinking, { type: 'adaptive' });
  assert.equal(options.env.ANTHROPIC_MODEL, options.model);
  assert.equal(options.env.ANTHROPIC_DEFAULT_SONNET_MODEL, options.model);
  assert.equal(options.env.ANTHROPIC_BASE_URL, 'https://api.minimax.io/anthropic');
  assert.equal(options.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1000000');
  assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, 'fixture-minimax-key');
  assert.equal(options.env.ANTHROPIC_API_KEY, undefined);
});

test('explicit M3, legacy and custom selections reach the SDK unchanged', async () => {
  for (const model of ['MiniMax-M3', 'MiniMax-M2.7', 'custom-deployment']) {
    const { options } = await send({ model });
    assert.equal(options.model, model);
    assert.equal(options.env.ANTHROPIC_MODEL, model);
    assert.equal(options.thinking, undefined);
    assert.equal(options.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, model === 'MiniMax-M2.7' ? '204800' : '1000000');
  }
});

test('persisted session override is reflected in active lookup, SDK model and environment', async () => {
  for (const model of ['MiniMax-M3', 'MiniMax-M2.7', 'custom-saved-model']) {
    const sessionId = `saved-${model}`;
    await models.changeActiveModel({ sessionId, model });
    assert.deepEqual(await models.getCurrentActiveModel(sessionId), { model });
    const { options } = await send({ sessionId, model: 'MiniMax-M3.1-Flash' });
    assert.equal(options.model, model);
    assert.equal(options.env.ANTHROPIC_MODEL, model);
    assert.equal(options.resume, sessionId);
    assert.equal(options.thinking, undefined);
  }
  assert.deepEqual(await models.getCurrentActiveModel(), { model: 'MiniMax-M3.1-Flash' });
});

test('historical transcripts retain their model without an explicit session override', async () => {
  for (const model of ['MiniMax-M3', 'MiniMax-M2.7', 'custom-history-model']) {
    const sessionId = `history-${model}`;
    const transcriptPath = path.join(testHome, `${sessionId}.jsonl`);
    await writeFile(transcriptPath, JSON.stringify({ type: 'assistant', sessionId, message: { model, content: [] } }) + '\n');
    transcriptPaths.set(sessionId, transcriptPath);
    assert.deepEqual(await models.getCurrentActiveModel(sessionId), { model });
    assert.equal((await send({ sessionId })).options.model, model);
  }
});

test('Flash effort accepts low through max and omits unsupported values', async () => {
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const { options } = await send({ effort });
    assert.equal(options.effort, effort);
    assert.deepEqual(options.thinking, { type: 'adaptive' });
  }
  assert.equal((await send({ effort: 'none' })).options.effort, undefined);
  assert.equal((await send({ effort: 'default' })).options.effort, 'max');
  assert.equal((await send()).options.effort, 'max');
  assert.equal((await send({ model: 'MiniMax-M3', effort: 'max' })).options.effort, undefined);
});

test('China and explicit endpoints are preserved at the SDK boundary', async () => {
  assert.equal((await send({}, { MINIMAX_REGION: 'cn' })).options.env.ANTHROPIC_BASE_URL, 'https://api.minimaxi.com/anthropic');
  assert.equal((await send({}, { MINIMAX_ANTHROPIC_BASE_URL: 'https://gateway.example.test/anthropic/' })).options.env.ANTHROPIC_BASE_URL, 'https://gateway.example.test/anthropic');
});

test('configured MiniMax model is preserved while unrelated Anthropic configuration is not adopted', async () => {
  const { options } = await send({}, {
    ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
    ANTHROPIC_MODEL: 'MiniMax-M2.7',
  });
  assert.equal(options.model, 'MiniMax-M2.7');
  assert.equal(options.env.ANTHROPIC_MODEL, 'MiniMax-M2.7');
  assert.equal((await send({}, { ANTHROPIC_MODEL: 'claude-sonnet-4-6' })).options.model, 'MiniMax-M3.1-Flash');
});

test('MiniMax settings model is preserved when request has no explicit selection', async () => {
  await mkdir(path.join(testHome, '.claude'), { recursive: true });
  const settingsPath = path.join(testHome, '.claude', 'settings.json');
  await writeFile(settingsPath, JSON.stringify({ env: {
    ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic', ANTHROPIC_MODEL: 'saved-settings-model',
  } }));
  assert.equal((await send()).options.model, 'saved-settings-model');
  assert.equal((await send({ model: 'MiniMax-M3' })).options.model, 'MiniMax-M3');
  await writeFile(settingsPath, '{}');
});

test('stale MiniMax catalog cache does not mask shipped choices and default', async () => {
  const current = Date.now();
  await mkdir(path.join(testHome, '.cloudcli'), { recursive: true });
  await writeFile(path.join(testHome, '.cloudcli', 'provider-models-cache.json'), JSON.stringify({
    version: 2,
    entries: { minimax: { updatedAt: current, expiresAt: current + 86400000,
      models: { DEFAULT: 'MiniMax-M2.7', OPTIONS: [{ value: 'MiniMax-M2.7', label: 'old' }] } } },
  }));
  providerModelsService.clearCache();
  const result = await providerModelsService.getProviderModels('minimax');
  assert.equal(result.models.DEFAULT, 'MiniMax-M3.1-Flash');
  assert.deepEqual(result.models.OPTIONS.map(({ value }) => value), ['MiniMax-M3.1-Flash', 'MiniMax-M3']);
});

test('real SDK serializes model, effort, adaptive thinking and prompt into its subprocess protocol', async () => {
  useRealSdk = true;
  try {
    for (const [options, environment, expected] of [
      [{}, {}, 'MiniMax-M3.1-Flash'],
      [{ effort: 'low' }, { MINIMAX_REGION: 'cn' }, 'MiniMax-M3.1-Flash'],
      [{ model: 'MiniMax-M3' }, {}, 'MiniMax-M3'],
      [{ sessionId: 'saved-MiniMax-M2.7' }, {}, 'MiniMax-M2.7'],
      [{ model: 'custom-deployment' }, {}, 'custom-deployment'],
    ]) {
      await send(options, environment);
      const transport = transports.at(-1);
      assert.equal(transport.args[transport.args.indexOf('--model') + 1], expected);
      assert.equal(transport.env.ANTHROPIC_MODEL, expected);
      assert.equal(transport.env.ANTHROPIC_BASE_URL,
        environment.MINIMAX_REGION === 'cn' ? 'https://api.minimaxi.com/anthropic' : 'https://api.minimax.io/anthropic');
      const initialization = transport.messages.find((message) => message.request?.subtype === 'initialize');
      assert.ok(initialization);
      if (expected === 'MiniMax-M3.1-Flash') {
        assert.equal(transport.args[transport.args.indexOf('--effort') + 1], options.effort || 'max');
        assert.equal(transport.args[transport.args.indexOf('--thinking') + 1], 'adaptive');
      } else {
        assert.equal(transport.args.includes('--effort'), false);
      }
      assert.deepEqual(transport.messages.find((message) => message.type === 'user').message.content,
        [{ type: 'text', text: 'Say hello' }]);
    }
  } finally {
    useRealSdk = false;
  }
});

test('real SDK retains image content alongside text for the MiniMax runtime', async () => {
  const imagePath = path.join(testHome, 'fixture.png');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
  await writeFile(imagePath, image);
  useRealSdk = true;
  try {
    await send({ cwd: testHome, images: [{ path: imagePath, mimeType: 'image/png' }] });
    const content = transports.at(-1).messages.find((message) => message.type === 'user').message.content;
    assert.ok(content.some((block) => block.type === 'text' && block.text.includes('Say hello')));
    assert.deepEqual(content.find((block) => block.type === 'image').source,
      { type: 'base64', media_type: 'image/png', data: image.toString('base64') });
  } finally {
    useRealSdk = false;
  }
});

test('Claude control retains its model, effort and environment without MiniMax thinking override', async () => {
  const { options } = await send({ model: 'opus', effort: 'low' }, {
    ANTHROPIC_API_KEY: 'fixture-claude-key', ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  }, queryClaudeSDK);
  assert.equal(options.model, 'opus');
  assert.equal(options.effort, 'low');
  assert.equal(options.thinking, undefined);
  assert.equal(options.env.ANTHROPIC_API_KEY, 'fixture-claude-key');
  assert.equal(options.env.ANTHROPIC_BASE_URL, 'https://api.anthropic.com');
});
