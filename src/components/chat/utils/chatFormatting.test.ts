/**
 * Regression tests for unescapeWithMathProtection — the escape-sequence pass that
 * used to shred LaTeX. Run: npx tsx --test src/components/chat/utils/chatFormatting.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { unescapeWithMathProtection } from './chatFormatting';

describe('unescapeWithMathProtection', () => {
  it('keeps LaTeX commands intact and rewrites \\[…\\] to $$…$$', () => {
    const out = unescapeWithMathProtection('\\[ \\text{fixed net} = \\text{fixed gross} \\]');
    // The bug: `\t` became a real TAB, so `\text` rendered as "ext" and a leading
    // TAB turned the equation into an indented code block.
    assert.ok(!out.includes('\t'), 'no TAB may be introduced');
    assert.ok(out.includes('\\text{fixed net}'), '\\text must survive verbatim');
    assert.equal(out, '$$ \\text{fixed net} = \\text{fixed gross} $$');
  });

  it('rewrites inline \\(…\\) to $$…$$ and preserves \\times / \\rho', () => {
    const out = unescapeWithMathProtection('rate \\( \\rho \\times 2 \\) done');
    assert.equal(out, 'rate $$ \\rho \\times 2 $$ done');
  });

  it('leaves currency prose untouched', () => {
    const text = 'Tiered fees for $200k exposure, and the fixed-$100k stats use it.';
    assert.equal(unescapeWithMathProtection(text), text);
  });

  it('never rewrites LaTeX-looking delimiters inside code', () => {
    const fenced = '```\ngrep -E "\\[0-9\\]" file\n```';
    assert.equal(unescapeWithMathProtection(fenced), fenced, 'fenced code is verbatim');
    assert.equal(unescapeWithMathProtection('use `\\[0-9\\]` here'), 'use `\\[0-9\\]` here');
  });

  it('still expands literal \\n outside protected regions', () => {
    assert.equal(unescapeWithMathProtection('line one\\nline two'), 'line one\nline two');
  });

  it('does not let literal placeholder text hijack a protected block', () => {
    // A message that talks about the internal token must survive verbatim, even
    // though a real protected block is present in the same message.
    const text = 'see __PROTECTED_BLOCK_0__ and `code`';
    assert.equal(unescapeWithMathProtection(text), text);
  });

  it('keeps $$…$$ math verbatim', () => {
    const text = '$$ \\theta_{t+1} = \\theta_t \\times 2 $$';
    assert.equal(unescapeWithMathProtection(text), text);
  });
});
