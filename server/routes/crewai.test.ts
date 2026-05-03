import assert from 'node:assert/strict';
import { describe, test, mock, beforeEach } from 'node:test';

import { createCrewAIRunner } from '@/services/crewai-runner.service.js';

import crewaiRouter from '@/routes/crewai.js';

describe('crewai route', () => {
  test('module exports an express Router', () => {
    assert.ok(crewaiRouter);
    assert.equal(typeof crewaiRouter, 'function');
  });

  test('router has GET /status and POST /start and POST /abort/:runId routes', () => {
    const routes = (crewaiRouter as any).stack
      ?.map((layer: any) => ({
        method: Object.keys(layer.route?.methods || {})[0],
        path: layer.route?.path,
      }))
      .filter((r: any) => r.path);

    assert.ok(routes.some((r: any) => r.method === 'get' && r.path === '/status'));
    assert.ok(routes.some((r: any) => r.method === 'post' && r.path === '/start'));
    assert.ok(routes.some((r: any) => r.method === 'post' && r.path === '/abort/:runId'));
  });
});
