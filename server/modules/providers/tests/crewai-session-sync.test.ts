import assert from 'node:assert/strict';
import http from 'node:http';

vi.mock('@/modules/database/index.js', () => ({
  sessionsDb: {
    createSession: vi.fn(
      (sessionId: string) => sessionId
    ),
  },
}));

import { sessionsDb } from '@/modules/database/index.js';

import { CrewAISessionSynchronizer } from '@/modules/providers/list/crewai/crewai-session-synchronizer.provider.js';

let mockServer: http.Server;
let bridgePort: number;

const MOCK_CREW_RUNS = [
  {
    id: 'crew-run-001',
    crew_name: 'Research Crew',
    status: 'completed',
    result: 'Research findings summarized.',
    started_at: '2025-01-15T10:00:00Z',
    completed_at: '2025-01-15T10:05:00Z',
  },
  {
    id: 'crew-run-002',
    crew_name: 'Writing Crew',
    status: 'completed',
    result: 'Blog post drafted.',
    started_at: '2025-01-15T11:00:00Z',
    completed_at: '2025-01-15T11:10:00Z',
  },
];

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (req.url?.startsWith('/crew/runs')) {
      const url = new URL(req.url, `http://localhost:${bridgePort}`);
      const since = url.searchParams.get('since');
      let runs = MOCK_CREW_RUNS;
      if (since) {
        const sinceDate = new Date(since);
        runs = runs.filter(r => new Date(r.completed_at) > sinceDate);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(runs));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    mockServer.listen(0, () => {
      const addr = mockServer.address();
      bridgePort = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
    });
  });
});

beforeEach(() => {
  vi.mocked(sessionsDb.createSession).mockClear();
});

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

test('synchronize fetches completed crew runs from bridge', async () => {
  const sync = new CrewAISessionSynchronizer(`http://localhost:${bridgePort}`);
  const count = await sync.synchronize();
  assert.equal(count, 2);
  assert.equal(vi.mocked(sessionsDb.createSession).mock.calls.length, 2);
});

test('synchronize passes since parameter to bridge', async () => {
  const futureDate = new Date('2099-01-01T00:00:00Z');
  const sync = new CrewAISessionSynchronizer(`http://localhost:${bridgePort}`);
  const count = await sync.synchronize(futureDate);
  assert.equal(count, 0);
});

test('synchronize returns 0 when bridge is unreachable', async () => {
  const sync = new CrewAISessionSynchronizer('http://localhost:1');
  const count = await sync.synchronize();
  assert.equal(count, 0);
});

test('synchronizeFile returns null (CrewAI has no file-based sessions)', async () => {
  const sync = new CrewAISessionSynchronizer(`http://localhost:${bridgePort}`);
  const result = await sync.synchronizeFile('/any/path.jsonl');
  assert.equal(result, null);
});
