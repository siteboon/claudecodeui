import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectLineEnding,
  normalizeLineEndings,
  normalizeTerminalInput,
  normalizeTextForParsing,
  preserveExistingLineEndings,
  splitLines,
  stripUtf8Bom,
} from './text.js';

// This test verifies the parser can consume mixed OS line endings as one stable LF format.
test('normalizeTextForParsing converts CRLF and CR into LF', () => {
  assert.equal(normalizeTextForParsing('a\r\nb\rc\n'), 'a\nb\nc\n');
});

// This test verifies BOM stripping and explicit output line-ending control.
test('normalizeLineEndings strips a UTF-8 BOM and can emit CRLF', () => {
  assert.equal(stripUtf8Bom('\uFEFFhello'), 'hello');
  assert.equal(normalizeLineEndings('\uFEFFa\nb', 'crlf'), 'a\r\nb');
});

// This test verifies callers can opt into preserving or trimming empty lines explicitly.
test('splitLines supports empty-line preservation and trailing-line trimming', () => {
  assert.deepEqual(splitLines('a\r\n\r\nb\r\n'), ['a', '', 'b', '']);
  assert.deepEqual(
    splitLines('a\r\n\r\nb\r\n', {
      preserveEmptyLines: false,
      trimTrailingEmptyLine: true,
    }),
    ['a', 'b'],
  );
});

// This test verifies file rewrites can preserve the line-ending style already present on disk.
test('preserveExistingLineEndings reuses the current file style', () => {
  assert.equal(detectLineEnding('a\r\nb\r\n'), 'crlf');
  assert.equal(preserveExistingLineEndings('x\ny', 'a\r\nb\r\n'), 'x\r\ny');
});

// This test verifies pasted terminal input is normalized into carriage returns for PTY writes.
test('normalizeTerminalInput converts mixed newlines into carriage returns', () => {
  assert.equal(normalizeTerminalInput('one\r\ntwo\nthree\rfour'), 'one\rtwo\rthree\rfour');
});
