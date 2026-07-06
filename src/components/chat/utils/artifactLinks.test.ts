import assert from 'node:assert/strict';
import test from 'node:test';

import { getArtifactLinkKind, isArtifactLink } from './artifactLinks';

test('detects supported artifact file links', () => {
  assert.equal(getArtifactLinkKind('tmp/cloudcli-artifacts/demo.html'), 'html');
  assert.equal(getArtifactLinkKind('tmp/cloudcli-artifacts/overview.png'), 'image');
  assert.equal(isArtifactLink('mockups/screen.JPG'), true);
});

test('ignores non-artifact links and strips line suffixes', () => {
  assert.equal(getArtifactLinkKind('src/App.tsx'), null);
  assert.equal(getArtifactLinkKind('https://example.com/mockup.png'), null);
  assert.equal(getArtifactLinkKind('tmp/mockup.html:12'), 'html');
});

test('does not treat empty and anchor values as artifacts', () => {
  assert.equal(isArtifactLink(''), false);
  assert.equal(isArtifactLink('#mockups'), false);
});
