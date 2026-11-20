import assert from 'node:assert/strict';
import test from 'node:test';

import { readRunningApplicationVersion } from '../running-version.service.js';

const buildMetadataPath = '/app/dist-server/build-version.json';
const packageJsonPath = '/app/package.json';

test('a versioned deployment reports its compiled version instead of the source checkout version', () => {
  const files = new Map([
    [buildMetadataPath, '{"version":"1.37.4"}'],
    [packageJsonPath, '{"version":"1.37.1"}'],
  ]);
  assert.equal(readRunningApplicationVersion({
    buildMetadataPath,
    packageJsonPath,
    readTextFile: (filePath) => files.get(filePath)!,
  }), '1.37.4');
});

test('source runs and older builds use the application package version', () => {
  assert.equal(readRunningApplicationVersion({
    buildMetadataPath,
    packageJsonPath,
    readTextFile: (filePath) => {
      if (filePath === buildMetadataPath) throw new Error('ENOENT');
      return '{"version":"1.37.4"}';
    },
  }), '1.37.4');
});

test('invalid build metadata falls back to the application package version', () => {
  for (const invalid of ['broken', '{"version":null}', '{"version":""}']) {
    assert.equal(readRunningApplicationVersion({
      buildMetadataPath,
      packageJsonPath,
      readTextFile: (filePath) => filePath === buildMetadataPath ? invalid : '{"version":"1.37.4"}',
    }), '1.37.4');
  }
});

test('unavailable version metadata does not prevent startup', () => {
  assert.equal(readRunningApplicationVersion({
    buildMetadataPath,
    packageJsonPath,
    readTextFile: () => { throw new Error('ENOENT'); },
  }), null);
});
