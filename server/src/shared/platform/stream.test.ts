import assert from 'node:assert/strict';
import test from 'node:test';

import { createStreamLineAccumulator } from './stream.js';

// This test verifies CRLF split across chunk boundaries does not create a fake empty line.
test('createStreamLineAccumulator handles CRLF across chunk boundaries', () => {
  const accumulator = createStreamLineAccumulator();

  assert.deepEqual(accumulator.push('first\r'), []);
  assert.deepEqual(accumulator.push('\nsecond\r\nthird'), ['first', 'second']);
  assert.deepEqual(accumulator.flush(), ['third']);
});

// This test verifies the first chunk can safely contain a UTF-8 BOM.
test('createStreamLineAccumulator strips a BOM from the first chunk only', () => {
  const accumulator = createStreamLineAccumulator();

  assert.deepEqual(accumulator.push(Buffer.from('\uFEFFalpha\nbeta')), ['alpha']);
  assert.deepEqual(accumulator.flush(), ['beta']);
});

// This test verifies callers can intentionally drop empty lines when parsing command output.
test('createStreamLineAccumulator can discard empty lines', () => {
  const accumulator = createStreamLineAccumulator({ preserveEmptyLines: false });

  assert.deepEqual(accumulator.push('one\n\n'), ['one']);
  assert.deepEqual(accumulator.push('two\r\n\r\nthree'), ['two']);
  assert.deepEqual(accumulator.flush(), ['three']);
});

// This test verifies the parser can be reused for a second stream after reset.
test('createStreamLineAccumulator reset clears the internal buffer', () => {
  const accumulator = createStreamLineAccumulator();

  assert.deepEqual(accumulator.push('partial'), []);
  assert.equal(accumulator.peek(), 'partial');
  accumulator.reset();
  assert.equal(accumulator.peek(), '');
  assert.deepEqual(accumulator.push('done\n'), ['done']);
});
