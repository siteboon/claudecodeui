import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldCloseCodeEditor } from './unsavedChanges';

test('closes without prompting when editor content is unchanged', () => {
  let prompted = false;
  const shouldClose = shouldCloseCodeEditor({
    isDirty: false,
    confirm: () => {
      prompted = true;
      return false;
    },
  });

  assert.equal(shouldClose, true);
  assert.equal(prompted, false);
});

test('keeps editor open when unsaved changes are rejected', () => {
  const shouldClose = shouldCloseCodeEditor({
    isDirty: true,
    confirm: () => false,
  });

  assert.equal(shouldClose, false);
});

test('closes editor when unsaved changes are confirmed', () => {
  const shouldClose = shouldCloseCodeEditor({
    isDirty: true,
    confirm: () => true,
  });

  assert.equal(shouldClose, true);
});
