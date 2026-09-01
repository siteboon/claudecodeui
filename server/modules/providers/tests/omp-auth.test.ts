/**
 * Unit test for OmpProviderAuth (P7). The off-PATH case is deterministic; the
 * real-binary case just asserts a well-formed, non-throwing status (portable
 * across machines that may or may not have omp / an agent.db).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OmpProviderAuth } from '@/modules/providers/list/omp/omp-auth.provider.js';

describe('OmpProviderAuth', () => {
  it('reports installed:false when omp is off PATH (async spawn, fail-closed)', async () => {
    const prev = process.env.OMP_PATH;
    process.env.OMP_PATH = '/nonexistent/omp-xyz';
    try {
      const status = await new OmpProviderAuth().getStatus();
      assert.equal(status.installed, false);
      assert.equal(status.authenticated, false);
      assert.equal(status.provider, 'omp');
      assert.ok(status.error, 'not-installed carries an error');
    } finally {
      if (prev === undefined) delete process.env.OMP_PATH; else process.env.OMP_PATH = prev;
    }
  });

  it('returns a well-formed status against the real binary without throwing', async () => {
    const status = await new OmpProviderAuth().getStatus();
    assert.equal(status.provider, 'omp');
    assert.equal(typeof status.installed, 'boolean');
    assert.equal(typeof status.authenticated, 'boolean');
  });
});
