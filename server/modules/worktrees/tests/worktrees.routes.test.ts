import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import { createWorktreesRouter } from '@/modules/worktrees/worktrees.routes.js';
import type {
  CreateWorktreeInput,
  OpenWorktreeInput,
  WorktreeServices,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

function createFakeServices(overrides: Partial<WorktreeServices> = {}): WorktreeServices {
  const unused = async (): Promise<never> => {
    throw new Error('Unexpected Worktrees service call');
  };

  return {
    resolveProjectPath: () => {
      throw new Error('Unexpected project resolution');
    },
    list: unused,
    create: unused,
    open: unused,
    merge: unused,
    remove: unused,
    ...overrides,
  };
}

async function withWorktreesServer(
  services: WorktreeServices,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/worktrees', createWorktreesRouter(services));
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

test('create route parses input and orchestrates create then open services', async () => {
  const createInputs: CreateWorktreeInput[] = [];
  const openInputs: OpenWorktreeInput[] = [];
  const services = createFakeServices({
    resolveProjectPath: (projectId) => {
      assert.equal(projectId, 'project-1');
      return '/workspace/repo';
    },
    create: async (input) => {
      createInputs.push(input);
      return {
        worktreePath: '/workspace/repo-worktrees/feature-login',
        branch: input.branch,
        createdBranch: true,
      };
    },
    open: async (input) => {
      openInputs.push(input);
      return {
        projectId: 'worktree-project-1',
        path: input.worktreePath,
        fullPath: input.worktreePath,
        displayName: 'repo · feature/login',
        isStarred: false,
        sessions: [],
        sessionMeta: { hasMore: false, total: 0 },
      };
    },
  });

  await withWorktreesServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/worktrees/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: ' project-1 ',
        branch: ' feature/login ',
        baseBranch: 'main',
      }),
    });
    const payload = await response.json() as {
      success: boolean;
      data: { project: { projectId: string } };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.success, true);
    assert.equal(payload.data.project.projectId, 'worktree-project-1');
  });

  assert.deepEqual(createInputs, [{
    projectPath: '/workspace/repo',
    branch: 'feature/login',
    baseBranch: 'main',
  }]);
  assert.deepEqual(openInputs, [{
    projectPath: '/workspace/repo',
    worktreePath: '/workspace/repo-worktrees/feature-login',
  }]);
});

test('create route rejects missing branch before calling a mutation service', async () => {
  let createCalled = false;
  const services = createFakeServices({
    resolveProjectPath: () => '/workspace/repo',
    create: async () => {
      createCalled = true;
      throw new Error('create should not run for invalid input');
    },
  });

  await withWorktreesServer(services, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/worktrees/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'project-1' }),
    });
    const payload = await response.json() as { error: string };

    assert.equal(response.status, 400);
    assert.equal(payload.error, 'INVALID_REQUEST_BODY');
  });

  assert.equal(createCalled, false);
});
