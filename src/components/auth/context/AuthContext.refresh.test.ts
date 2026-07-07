import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('token refresh does not rerun the initial auth bootstrap', async () => {
  const source = await readFile(new URL('./AuthContext.tsx', import.meta.url), 'utf8');

  assert.match(source, /if \(!readStoredToken\(\)\)/);
  assert.equal(source.includes('}, [checkOnboardingStatus, clearSession, token]);'), false);
});
