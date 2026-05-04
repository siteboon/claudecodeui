import assert from 'node:assert/strict';
import http from 'node:http';

vi.mock('@/modules/providers/services/sessions.service.js', () => ({
  sessionsService: { ensureSessionAndProject: vi.fn() },
}));

/* eslint-disable boundaries/no-unknown -- root-level server file, not a module */
import {
  queryCrewAI,
  abortCrewAISession,
  isCrewAISessionActive,
  getActiveCrewAISessions,
} from '@/crewai-bridge-client.js';
/* eslint-enable boundaries/no-unknown */

let mockServer: http.Server;
let bridgePort: number;

beforeAll(async () => {
  mockServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/crew/run') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'status', message: 'Starting...' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'result', output: 'Done.' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
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

afterAll(async () => {
  await new Promise<void>((resolve) => mockServer.close(() => resolve()));
});

test('queryCrewAI is a function', () => {
  assert.equal(typeof queryCrewAI, 'function');
});

test('abortCrewAISession returns false for unknown session', () => {
  assert.equal(abortCrewAISession('nonexistent'), false);
});

test('isCrewAISessionActive returns false for unknown session', () => {
  assert.equal(isCrewAISessionActive('nonexistent'), false);
});

test('getActiveCrewAISessions returns a Map', () => {
  const sessions = getActiveCrewAISessions();
  assert.ok(sessions instanceof Map);
});
