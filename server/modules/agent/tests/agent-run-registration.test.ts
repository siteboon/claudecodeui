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
import { chatRunRegistry, connectedClients } from '@/modules/websocket/index.js';
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
