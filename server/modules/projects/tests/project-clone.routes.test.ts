import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { createProjectCloneRouter } from '@/modules/projects/project-clone.routes.js';
import { createPendingCloneRequests } from '@/modules/projects/services/project-clone-request.service.js';
import type { startCloneProject } from '@/modules/projects/services/project-clone.service.js';
import { AppError } from '@/shared/utils.js';

type CloneRunner = typeof startCloneProject;
type CloneInput = Parameters<CloneRunner>[0];

/**
 * A clone runner that reports one progress line and completes at once. What
 * it was asked to clone is recorded so a test can check the request survived
 * the POST -> claim -> run hand-off intact.
 */
function createFakeCloneRunner(inputs: CloneInput[]): CloneRunner {
  return async (input, handlers) => {
    inputs.push(input);
    handlers.onProgress('Receiving objects: 100% (20/20), done.');
    handlers.onComplete({ project: { projectId: 'project-1' }, message: 'Repository cloned successfully' });
    return { waitForCompletion: Promise.resolve(), cancel: () => undefined };
  };
}

const unexpectedCloneRunner: CloneRunner = async () => {
  throw new Error('startCloneProject must not run before the progress stream is opened');
};

type ServerOptions = {
  startCloneProject: CloneRunner;
  pendingCloneTtlMs?: number;
};

// The auth middleware is mounted ahead of the router in production; here the
// `x-user-id` header plays its part so a test can act as two different users.
async function withProjectsServer(
  options: ServerOptions,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.header('x-user-id');
    if (userId) {
      (req as Request & { user?: { id: number } }).user = { id: Number(userId) };
    }
    next();
  });
  app.use('/api/projects', createProjectCloneRouter({
    startCloneProject: options.startCloneProject,
    pendingCloneRequests: createPendingCloneRequests(options.pendingCloneTtlMs ?? 60_000),
  }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.code });
      return;
    }

    res.status(500).json({ error: 'INTERNAL_ERROR' });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const cloneBody = {
  path: '/workspace/root',
  githubUrl: 'https://github.com/example/repo.git',
  githubTokenId: null,
  newGithubToken: 'ghp_supersecrettoken1234567890abcd',
};

async function postClone(baseUrl: string, userId: number, body: Record<string, unknown> = cloneBody) {
  const response = await fetch(`${baseUrl}/api/projects/clone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': String(userId) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as { cloneId?: string; error?: string } };
}

async function openProgress(baseUrl: string, userId: number, cloneId: string) {
  const response = await fetch(
    `${baseUrl}/api/projects/clone-progress?cloneId=${encodeURIComponent(cloneId)}`,
    { headers: { 'x-user-id': String(userId) } },
  );
  const text = await response.text();
  const events = text
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)) as { type: string; message?: string });
  return { status: response.status, contentType: response.headers.get('content-type') ?? '', text, events };
}

test('POST /clone parks the request under a fresh id without spawning anything', async () => {
  await withProjectsServer({ startCloneProject: unexpectedCloneRunner }, async (baseUrl) => {
    const first = await postClone(baseUrl, 1);
    const second = await postClone(baseUrl, 1);

    assert.equal(first.status, 200);
    assert.match(first.body.cloneId ?? '', /^[0-9a-f-]{36}$/);
    assert.notEqual(first.body.cloneId, second.body.cloneId);
  });
});

test('POST /clone requires an authenticated user', async () => {
  await withProjectsServer({ startCloneProject: unexpectedCloneRunner }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/projects/clone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cloneBody),
    });

    assert.equal(response.status, 401);
  });
});

test('GET /clone-progress streams the clone the id names, then retires the id', async () => {
  const inputs: CloneInput[] = [];
  await withProjectsServer({ startCloneProject: createFakeCloneRunner(inputs) }, async (baseUrl) => {
    const { body } = await postClone(baseUrl, 7, { ...cloneBody, githubTokenId: 12, newGithubToken: null });
    assert.equal(inputs.length, 0, 'the POST alone must not start a clone');

    const stream = await openProgress(baseUrl, 7, body.cloneId ?? '');

    assert.equal(stream.status, 200);
    assert.match(stream.contentType, /^text\/event-stream/);
    assert.deepEqual(stream.events.map((event) => event.type), ['progress', 'complete']);
    assert.equal(stream.events[0]?.message, 'Receiving objects: 100% (20/20), done.');
    assert.deepEqual(inputs, [{
      workspacePath: '/workspace/root',
      githubUrl: 'https://github.com/example/repo.git',
      githubTokenId: 12,
      newGithubToken: null,
      userId: 7,
    }]);

    const replay = await openProgress(baseUrl, 7, body.cloneId ?? '');
    assert.equal(replay.status, 404, 'a claimed id must not run the clone twice');
  });
});

test('GET /clone-progress hands the posted token to the clone without it touching the URL', async () => {
  const inputs: CloneInput[] = [];
  await withProjectsServer({ startCloneProject: createFakeCloneRunner(inputs) }, async (baseUrl) => {
    const { body } = await postClone(baseUrl, 1);
    const stream = await openProgress(baseUrl, 1, body.cloneId ?? '');

    assert.equal(stream.status, 200);
    assert.equal(inputs[0]?.newGithubToken, cloneBody.newGithubToken);
    assert.ok(!(body.cloneId ?? '').includes(cloneBody.newGithubToken));
  });
});

test('GET /clone-progress rejects an unknown id with 404', async () => {
  await withProjectsServer({ startCloneProject: unexpectedCloneRunner }, async (baseUrl) => {
    const stream = await openProgress(baseUrl, 1, 'not-a-clone-id');

    assert.equal(stream.status, 404);
    assert.deepEqual(JSON.parse(stream.text), { error: 'CLONE_REQUEST_NOT_FOUND' });
  });
});

test('GET /clone-progress rejects another user id with 404 and keeps it for its owner', async () => {
  const inputs: CloneInput[] = [];
  await withProjectsServer({ startCloneProject: createFakeCloneRunner(inputs) }, async (baseUrl) => {
    const { body } = await postClone(baseUrl, 1);

    const foreign = await openProgress(baseUrl, 2, body.cloneId ?? '');
    assert.equal(foreign.status, 404);
    assert.equal(inputs.length, 0, 'a foreign claim must not run the clone');

    const owner = await openProgress(baseUrl, 1, body.cloneId ?? '');
    assert.equal(owner.status, 200);
    assert.equal(inputs[0]?.userId, 1);
  });
});

test('GET /clone-progress rejects an expired id with 404', async () => {
  await withProjectsServer(
    { startCloneProject: unexpectedCloneRunner, pendingCloneTtlMs: 20 },
    async (baseUrl) => {
      const { body } = await postClone(baseUrl, 1);
      await new Promise((resolve) => setTimeout(resolve, 60));

      const stream = await openProgress(baseUrl, 1, body.cloneId ?? '');
      assert.equal(stream.status, 404);
    },
  );
});
