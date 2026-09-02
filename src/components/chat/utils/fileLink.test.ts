import test from 'node:test';
import assert from 'node:assert/strict';

import { filePathFromFileUrl, isFileUrl, markdownUrlTransform } from './fileLink';

// Antigravity renders plan links as `[name.md](file:///Users/.../brain/<id>/name.md)`.
// Before the file-link helpers existed, react-markdown's default URL transform
// stripped the `file:` scheme, the anchor fell back to the bare link text, and
// clicking the plan link produced a 404 in the editor. These tests pin the
// exact contract that keeps those links working.

test('isFileUrl matches file URLs case-insensitively and rejects everything else', () => {
  assert.equal(isFileUrl('file:///Users/azrael/plan.md'), true);
  assert.equal(isFileUrl('FILE:///C:/plan.md'), true);
  assert.equal(isFileUrl('https://example.com/plan.md'), false);
  assert.equal(isFileUrl('/Users/azrael/plan.md'), false);
  assert.equal(isFileUrl(undefined), false);
  assert.equal(isFileUrl(''), false);
});

test('filePathFromFileUrl decodes a plain local file URL', () => {
  assert.equal(
    filePathFromFileUrl('file:///Users/azrael/.gemini/antigravity-cli/brain/28b2c337/plan.md'),
    '/Users/azrael/.gemini/antigravity-cli/brain/28b2c337/plan.md',
  );
});

test('filePathFromFileUrl decodes percent-escaped spaces and non-ASCII names', () => {
  assert.equal(
    filePathFromFileUrl('file:///Users/azrael/My%20Plans/%E6%9D%83%E9%99%90%E8%AE%A1%E5%88%92.md'),
    '/Users/azrael/My Plans/权限计划.md',
  );
});

test('filePathFromFileUrl accepts an explicit localhost host', () => {
  assert.equal(
    filePathFromFileUrl('file://localhost/Users/azrael/plan.md'),
    '/Users/azrael/plan.md',
  );
});

test('filePathFromFileUrl rejects remote hosts and non-file URLs', () => {
  assert.equal(filePathFromFileUrl('file://server/share/plan.md'), undefined);
  assert.equal(filePathFromFileUrl('https://example.com/plan.md'), undefined);
  assert.equal(filePathFromFileUrl('/Users/azrael/plan.md'), undefined);
  assert.equal(filePathFromFileUrl(undefined), undefined);
});

test('markdownUrlTransform keeps file URLs verbatim', () => {
  const url = 'file:///Users/azrael/plan%20a.md';
  assert.equal(markdownUrlTransform(url), url);
});

test('markdownUrlTransform delegates non-file URLs to the default transform', () => {
  assert.equal(
    markdownUrlTransform('https://example.com/plan.md'),
    'https://example.com/plan.md',
  );
  // Dangerous schemes must still be stripped by the default transform.
  assert.equal(markdownUrlTransform('javascript:alert(1)'), '');
});
