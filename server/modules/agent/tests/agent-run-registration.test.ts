import assert from 'node:assert/strict';
import * as nodeCrypto from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import {
  chatRunRegistry,
  connectedClients,
  endUnusedShellsForSession,
  isSessionHeldByShell,
} from '@/modules/websocket/index.js';
import type { NormalizedMessage } from '@/shared/types.js';
import { createNormalizedMessage } from '@/shared/utils.js';

import { createAgentRouter } from '../agent.routes.js';

/**
 * `POST /api/agent` runs a provider for an API-key caller. Until now it wrote
 * the run's events straight to the HTTP response and nothing else knew: the
 * session was not on the running-sessions list, no tab could subscribe to
 * it, and a second request could start a second run on the same session. It
 * now registers the run with the chat run registry the way a `chat.send`
 * does, with the HTTP response as the run's first audience.
 */

type AgentDependencies = Parameters<typeof createAgentRouter>[0];
type RunFunction = AgentDependencies['queryClaude'];

async function withIsolatedDatabase(run: () => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'agent-run-registration-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
  await initializeDatabase();
  try {
    await run();
  } finally {
    connectedClients.clear();
    chatRunRegistry.clearAll();
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function createDependencies(queryClaude: RunFunction): AgentDependencies {
  const unexpected = async (): Promise<never> => { throw new Error('unexpected provider call'); };
  return {
    fileSystem: { access: async () => undefined } as unknown as AgentDependencies['fileSystem'],
    crypto: nodeCrypto,
    homeDirectory: () => '/home/test',
    spawnProcess: (() => { throw new Error('spawn should not run'); }) as unknown as AgentDependencies['spawnProcess'],
    platformMode: true,
    users: { getFirstUser: () => ({ id: 1, username: 'test-user' }) },
    apiKeys: { validateApiKey: () => undefined },
    githubTokens: { getActiveGithubToken: () => null },
    projects: { createProjectPath: () => ({ outcome: 'created' }) },
    models: { getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'default-model' }) } as unknown as AgentDependencies['models'],
    sessions: {
      getSessionById: (sessionId) => sessionsDb.getSessionById(sessionId),
      getSessionByProviderSessionId: (providerSessionId) => sessionsDb.getSessionByProviderSessionId(providerSessionId),
      createAppSession: (provider, projectPath, initialMessage) => {
        const sessionId = `app-${initialMessage.length}-${nodeCrypto.randomUUID()}`;
        sessionsDb.createAppSession(sessionId, provider, projectPath, initialMessage);
        return { sessionId };
      },
    },
    runs: chatRunRegistry,
    shells: { isSessionHeldByShell, endUnusedShellsForSession },
    queryClaude,
    queryCursor: unexpected as RunFunction,
    queryCodex: unexpected as RunFunction,
    queryOpenCode: unexpected as RunFunction,
    GithubClient: class {} as unknown as AgentDependencies['GithubClient'],
  };
}

async function withAgentServer(dependencies: AgentDependencies, run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', createAgentRouter(dependencies));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const post = (baseUrl: string, body: Record<string, unknown>) =>
  fetch(`${baseUrl}/api/agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const readEvents = async (response: Response): Promise<Array<Record<string, unknown>>> =>
  (await response.text())
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)) as Record<string, unknown>);

/** A runtime that announces its native session id, streams one text event, and waits to be released before completing. */
function createHeldRuntime(nativeSessionId = 'native-1') {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const seen: Array<{ sessionId: unknown; writerIsGateway: boolean }> = [];
  const queryClaude: RunFunction = async (_command, options, writer) => {
    seen.push({ sessionId: (options as { sessionId?: unknown }).sessionId, writerIsGateway: Boolean((writer as { isWebSocketWriter?: boolean }).isWebSocketWriter) });
    // A resumed session announces the id it resumed under; a new one, a fresh id.
    const announced = (writer as { getSessionId?: () => string | null }).getSessionId?.() ?? nativeSessionId;
    writer.send(createNormalizedMessage({ kind: 'session_created', provider: 'claude', sessionId: announced, newSessionId: announced }));
    writer.send(createNormalizedMessage({ kind: 'text', provider: 'claude', sessionId: announced, role: 'assistant', content: 'hello' }));
    await released;
    writer.send(createNormalizedMessage({ kind: 'complete', provider: 'claude', sessionId: announced, exitCode: 0 }));
  };
  return { queryClaude, release, seen };
}

test('an API run is registered like a chat send: listed while running, streamed decorated, mapped to its native id', async () => {
  await withIsolatedDatabase(async () => {
    const runtime = createHeldRuntime();
    await withAgentServer(createDependencies(runtime.queryClaude), async (baseUrl) => {
      const responsePromise = post(baseUrl, { projectPath: '/home/test/project', message: 'Run it' });
      // Wait for the runtime to be entered.
      for (let i = 0; i < 50 && runtime.seen.length === 0; i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 20); });
      }

      const [running] = chatRunRegistry.listRunningRuns();
      assert.ok(running, 'the run is on the running-sessions list while the provider works');
      assert.equal(running.provider, 'claude');
      assert.match(running.sessionId, /^app-/, 'listed under the app session id the route allocated');
      assert.deepEqual(runtime.seen, [{ sessionId: running.sessionId, writerIsGateway: true }], 'the runtime gets the app id and the run\'s gateway writer');
      // A tab that opens the session mid-run replays what it missed.
      assert.deepEqual(chatRunRegistry.replayEvents(running.sessionId, 0).map((event) => event.kind), ['text']);

      runtime.release();
      const response = await responsePromise;
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
      const events = await readEvents(response);
      assert.deepEqual(events.map((event) => event.type ?? event.kind), ['status', 'session-id', 'text', 'complete', 'done']);
      assert.equal(events[1]?.sessionId, running.sessionId, 'session-id names the app session, not the provider\'s');
      // Provider events reach the stream as a tab would see them: app session id, sequenced, no session_created.
      const text = events[2] as NormalizedMessage;
      assert.equal(text.sessionId, running.sessionId);
      assert.equal(text.seq, 1);

      assert.equal(chatRunRegistry.isProcessing(running.sessionId), false, 'the terminal complete ends the run');
      assert.equal(sessionsDb.getSessionById(running.sessionId)?.provider_session_id, 'native-1', 'the native id the runtime announced is mapped onto the row');
    });
  });
});

test('a second API request on a session mid-run is refused with 409, as the chat socket refuses it', async () => {
  await withIsolatedDatabase(async () => {
    const runtime = createHeldRuntime();
    await withAgentServer(createDependencies(runtime.queryClaude), async (baseUrl) => {
      const first = post(baseUrl, { projectPath: '/home/test/project', message: 'Run it' });
      for (let i = 0; i < 50 && runtime.seen.length === 0; i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 20); });
      }
      const [running] = chatRunRegistry.listRunningRuns();
      assert.ok(running);

      const second = await post(baseUrl, { projectPath: '/home/test/project', message: 'Again', sessionId: running.sessionId, stream: false });
      assert.equal(second.status, 409);
      assert.equal(runtime.seen.length, 1, 'the provider is not entered twice');

      runtime.release();
      await first;
    });
  });
});

test('a non-streaming API run answers with the app session id and is off the list once done', async () => {
  await withIsolatedDatabase(async () => {
    const runtime = createHeldRuntime();
    runtime.release();
    await withAgentServer(createDependencies(runtime.queryClaude), async (baseUrl) => {
      const response = await post(baseUrl, { projectPath: '/home/test/project', message: 'Run it', stream: false });
      assert.equal(response.status, 200);
      const body = await response.json() as { success: boolean; sessionId: string };
      assert.equal(body.success, true);
      assert.match(body.sessionId, /^app-/);
      assert.deepEqual(chatRunRegistry.listRunningRuns(), []);
    });
  });
});

test('an API run continues a session the caller names by either id, and refuses one that does not exist', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-existing', 'claude', '/home/test/project', 'Existing');
    sessionsDb.assignProviderSessionId('app-existing', 'native-existing');
    const runtime = createHeldRuntime();
    runtime.release();
    await withAgentServer(createDependencies(runtime.queryClaude), async (baseUrl) => {
      const byAppId = await post(baseUrl, { projectPath: '/home/test/project', message: 'More', sessionId: 'app-existing', stream: false });
      assert.equal(byAppId.status, 200);
      assert.equal((await byAppId.json() as { sessionId: string }).sessionId, 'app-existing');

      // A caller that stored the provider-native id an earlier response gave it.
      const byNativeId = await post(baseUrl, { projectPath: '/home/test/project', message: 'More', sessionId: 'native-existing', stream: false });
      assert.equal(byNativeId.status, 200);
      assert.equal((await byNativeId.json() as { sessionId: string }).sessionId, 'app-existing');
      assert.deepEqual(runtime.seen.map((call) => call.sessionId), ['app-existing', 'app-existing']);

      const unknown = await post(baseUrl, { projectPath: '/home/test/project', message: 'More', sessionId: 'nope', stream: false });
      assert.equal(unknown.status, 404);
      assert.equal(runtime.seen.length, 2);
    });
  });
});

test('a runtime that throws leaves no run behind', async () => {
  await withIsolatedDatabase(async () => {
    const queryClaude: RunFunction = async () => { throw new Error('provider exploded'); };
    await withAgentServer(createDependencies(queryClaude), async (baseUrl) => {
      const response = await post(baseUrl, { projectPath: '/home/test/project', message: 'Run it', stream: false });
      assert.equal(response.status, 500);
      assert.deepEqual(chatRunRegistry.listRunningRuns(), [], 'the safety net completes the run');
    });
  });
});

test('a sessionId that is not a string is refused, not bound to a query', async () => {
  // The lookup runs before the handler's try: a throw there is an unhandled
  // rejection, and better-sqlite3 throws on binding an object.
  await withIsolatedDatabase(async () => {
    const runtime = createHeldRuntime();
    await withAgentServer(createDependencies(runtime.queryClaude), async (baseUrl) => {
      const response = await post(baseUrl, { projectPath: '/home/test/project', message: 'Run', sessionId: { $ne: null }, stream: false });
      assert.equal(response.status, 400);
      assert.equal(runtime.seen.length, 0);
    });
  });
});

test('a continued session runs under its own provider and project, as a chat send does', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-codex', 'codex', '/home/test/project', 'Codex one');
    const claudeCalls: unknown[] = [];
    const codexCalls: unknown[] = [];
    const dependencies = createDependencies(async (_command, options, writer) => {
      claudeCalls.push(options);
      writer.send(createNormalizedMessage({ kind: 'complete', provider: 'claude', sessionId: null, exitCode: 0 }));
    });
    dependencies.queryCodex = async (_command, options, writer) => {
      codexCalls.push(options);
      writer.send(createNormalizedMessage({ kind: 'complete', provider: 'codex', sessionId: null, exitCode: 0 }));
    };
    await withAgentServer(dependencies, async (baseUrl) => {
      // No provider named: the row's, not the default.
      const continued = await post(baseUrl, { projectPath: '/home/test/project', message: 'More', sessionId: 'app-codex', stream: false });
      assert.equal(continued.status, 200);
      assert.deepEqual([claudeCalls.length, codexCalls.length], [0, 1]);

      // Another provider named: refused, not re-homed.
      const mismatched = await post(baseUrl, { projectPath: '/home/test/project', message: 'More', sessionId: 'app-codex', provider: 'claude', stream: false });
      assert.equal(mismatched.status, 400);
      assert.equal(claudeCalls.length, 0);

      // Another directory named: not that session.
      const elsewhere = await post(baseUrl, { projectPath: '/home/test/other', message: 'More', sessionId: 'app-codex', stream: false });
      assert.equal(elsewhere.status, 500);
      assert.match((await elsewhere.json() as { error: string }).error, /belongs to project/);
      assert.equal(codexCalls.length, 1);
    });
  });
});

test('a busy session is refused before anything is cloned', async () => {
  await withIsolatedDatabase(async () => {
    const runtime = createHeldRuntime();
    const dependencies = createDependencies(runtime.queryClaude);
    let clones = 0;
    dependencies.spawnProcess = (() => { clones += 1; throw new Error('no clone expected'); }) as unknown as AgentDependencies['spawnProcess'];
    await withAgentServer(dependencies, async (baseUrl) => {
      const first = post(baseUrl, { projectPath: '/home/test/project', message: 'Run it' });
      for (let i = 0; i < 50 && runtime.seen.length === 0; i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 20); });
      }
      const [running] = chatRunRegistry.listRunningRuns();
      assert.ok(running);

      const retry = await post(baseUrl, { githubUrl: 'https://github.com/owner/repo.git', projectPath: '/home/test/project', message: 'Again', sessionId: running.sessionId, stream: false });
      assert.equal(retry.status, 409);
      assert.equal(clones, 0, 'the refusal comes before the clone step');

      runtime.release();
      await first;
    });
  });
});

test('a session the user has open in a Shell CLI is refused with 409, and a Shell only opened is ended first', async () => {
  await withIsolatedDatabase(async () => {
    sessionsDb.createAppSession('app-in-shell', 'claude', '/home/test/project', 'In the Shell');
    const runtime = createHeldRuntime();
    runtime.release();
    const dependencies = createDependencies(runtime.queryClaude);
    // What the Shell service answers: whether a CLI the user works in holds
    // the session at each check, and which sessions had an unused one ended.
    const heldAnswers: boolean[] = [];
    const ended: string[] = [];
    dependencies.shells = {
      isSessionHeldByShell: () => heldAnswers.shift() ?? false,
      endUnusedShellsForSession: (appSessionId) => { ended.push(appSessionId); },
    };
    await withAgentServer(dependencies, async (baseUrl) => {
      const request = { projectPath: '/home/test/project', message: 'More', sessionId: 'app-in-shell', stream: false };

      // Held when the request arrives: refused before any side effect.
      heldAnswers.push(true);
      const refused = await post(baseUrl, request);
      assert.equal(refused.status, 409);
      assert.match((await refused.json() as { error: string }).error, /open in a Shell CLI/);
      assert.deepEqual(ended, []);

      // Resumed in the Shell while the project was being prepared: refused at
      // the last check, before the run is registered.
      heldAnswers.push(false, true);
      const late = await post(baseUrl, request);
      assert.equal(late.status, 409);
      assert.deepEqual(ended, ['app-in-shell']);
      assert.equal(runtime.seen.length, 0, 'no second CLI is started');
      assert.deepEqual(chatRunRegistry.listRunningRuns(), []);

      // Not held: an unused Shell is ended, then the session continues.
      const continued = await post(baseUrl, request);
      assert.equal(continued.status, 200);
      assert.deepEqual(ended, ['app-in-shell', 'app-in-shell']);
      assert.deepEqual(runtime.seen.map((call) => call.sessionId), ['app-in-shell']);
    });
  });
});

test('a run a tab aborted ends without branching or opening a PR, and says so', async () => {
  await withIsolatedDatabase(async () => {
    const runtime = createHeldRuntime();
    let gitCalls = 0;
    const dependencies = createDependencies(async (command, options, writer) => {
      await runtime.queryClaude(command, options, writer);
    });
    dependencies.spawnProcess = (() => { gitCalls += 1; throw new Error('git should not run after an abort'); }) as unknown as AgentDependencies['spawnProcess'];
    await withAgentServer(dependencies, async (baseUrl) => {
      const responsePromise = post(baseUrl, { projectPath: '/home/test/project', message: 'Run it', createBranch: true, stream: false });
      for (let i = 0; i < 50 && runtime.seen.length === 0; i += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 20); });
      }
      const [running] = chatRunRegistry.listRunningRuns();
      assert.ok(running);
      // What chat.abort does: the run completes as aborted; the runtime then returns.
      chatRunRegistry.completeRun(running.sessionId, { exitCode: 1, aborted: true });
      runtime.release();

      const response = await responsePromise;
      const body = await response.json() as { success: boolean; aborted?: boolean; branch?: unknown };
      assert.equal(body.success, false);
      assert.equal(body.aborted, true);
      assert.equal(body.branch, undefined);
      assert.equal(gitCalls, 0);
    });
  });
});

test('a non-streaming run answers with the assistant\'s replies, its token usage and the provider id', async () => {
  await withIsolatedDatabase(async () => {
    const dependencies = createDependencies(async (_command, _options, writer) => {
      writer.send(createNormalizedMessage({ kind: 'session_created', provider: 'claude', sessionId: 'native-7', newSessionId: 'native-7' }));
      writer.send(createNormalizedMessage({ kind: 'text', provider: 'claude', sessionId: 'native-7', role: 'assistant', content: 'pong' }));
      writer.send(createNormalizedMessage({
        kind: 'status', text: 'token_budget', provider: 'claude', sessionId: 'native-7',
        tokenBudget: { used: 130, total: 160_000, inputTokens: 100, outputTokens: 30, cacheReadTokens: 60, cacheCreationTokens: 10, cacheTokens: 70, breakdown: { input: 100, output: 30 } },
      }));
      writer.send(createNormalizedMessage({ kind: 'complete', provider: 'claude', sessionId: 'native-7', exitCode: 0 }));
    });
    await withAgentServer(dependencies, async (baseUrl) => {
      const response = await post(baseUrl, { projectPath: '/home/test/project', message: 'ping', stream: false });
      const body = await response.json() as { providerSessionId: string; messages: Array<{ content: string }>; tokens: Record<string, number> };
      assert.equal(body.providerSessionId, 'native-7');
      assert.deepEqual(body.messages.map((message) => message.content), ['pong']);
      assert.deepEqual(body.tokens, { inputTokens: 100, outputTokens: 30, cacheReadTokens: 60, cacheCreationTokens: 10, totalTokens: 130 });
    });
  });
});
