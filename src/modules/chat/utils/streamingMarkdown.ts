/**
 * Splits a partially-streamed assistant message into a settled prefix and the
 * block still being written.
 *
 * The realtime handler pushes the whole accumulated reply every 100ms, so
 * rendering it as one markdown document re-parses the entire message ten times
 * a second — O(length) per tick and O(length²) over a reply. Splitting at a
 * block boundary lets the prefix render through a memoized <MarkdownBody>,
 * whose input only changes when a block completes, so each tick only parses the
 * tail.
 *
 * Correctness rests on markdown blocks being independent across a blank line:
 * rendering `settled` and `pending` as two documents must equal rendering their
 * concatenation. That does NOT hold inside a fenced code block, a display-math
 * block, a list, a blockquote, a table, an indented code block, or across a
 * link-reference/footnote definition and its usage — the boundary search skips
 * all of them.
 */

/** An opening or closing code fence, per CommonMark: up to 3 spaces of indent. */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

/** A `$$` display-math delimiter. remark-math is configured for block math only. */
const MATH_DELIMITER_PATTERN = /^ {0,3}\$\$/;

/**
 * Block starters whose meaning depends on the surrounding lines, checked on both
 * sides of a candidate blank line.
 *
 * Three of these are demonstrably load-bearing, each with a fixture in
 * streamingMarkdownComponent.test.tsx that renders differently if its arm is
 * removed: a blank line between list items makes the list loose (every item
 * gains a <p>), a blank line inside an indented code block does not end it, and
 * a reference definition split away from the text that uses it leaves the link
 * unresolved.
 *
 * The blockquote and table arms are conservative. CommonMark and GFM end both
 * blocks at a blank line, and no input has been found where splitting there
 * renders differently — they are kept because the cost of being wrong is a
 * visible layout break and the cost of being cautious is one more block staying
 * in the pending half for one tick.
 */
const CONTEXT_SENSITIVE_LINE = new RegExp([
  '^\\s*([-*+]|\\d+[.)])\\s',      // list item
  '^( {2,}|\\t)\\S',               // indented continuation or indented code
  '^\\s*>',                        // blockquote
  '^\\s*\\|',                      // table row
  '^ {0,3}\\[[^\\]]*\\]:',         // link reference or footnote definition
].join('|'));

export type StreamingMarkdownSplit = {
  /** Complete blocks. Stable between ticks, so its markdown parse is memoizable. */
  settled: string;
  /** The block still streaming. Re-parsed every tick, but bounded by one block. */
  pending: string;
};

/** The fence currently open, so only a matching marker closes it. */
type OpenFence = { marker: string; length: number };

export function splitStreamingMarkdown(content: string): StreamingMarkdownSplit {
  if (!content) {
    return { settled: '', pending: '' };
  }

  const lines = content.split('\n');
  let openFence: OpenFence | null = null;
  let insideMath = false;
  let boundaryLine = -1;

  // Offset of each line's first character, so the split is an exact slice.
  let offset = 0;
  const lineOffsets: number[] = [];
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    const fence = readFence(line);
    if (fence) {
      if (!openFence) {
        openFence = fence;
      } else if (closesFence(openFence, fence, line)) {
        // CommonMark: only the same marker, at least as long, with no info string.
        openFence = null;
      }
      continue;
    }

    if (!openFence && MATH_DELIMITER_PATTERN.test(line)) {
      // A self-contained `$$x$$` line opens and closes in one go; toggling on it
      // would leave the tracker stuck open and suppress every later boundary.
      if (countMathDelimiters(line) % 2 === 1) {
        insideMath = !insideMath;
      }
      continue;
    }

    if (openFence || insideMath || line.trim() !== '') {
      continue;
    }

    // Nothing settled yet: a leading blank line has no block before it.
    const previous = previousNonBlank(lines, index);
    if (previous === null || CONTEXT_SENSITIVE_LINE.test(lines[previous])) {
      continue;
    }

    // When a block follows, it must not be one whose meaning spans the blank
    // line. When nothing follows, the pending half is empty and the split is
    // trivially safe.
    const next = nextNonBlank(lines, index);
    if (next !== null && CONTEXT_SENSITIVE_LINE.test(lines[next])) {
      continue;
    }

    boundaryLine = index;
  }

  if (boundaryLine < 0) {
    return { settled: '', pending: content };
  }

  const splitAt = lineOffsets[boundaryLine] + lines[boundaryLine].length + 1;
  return {
    settled: content.slice(0, splitAt),
    pending: content.slice(splitAt),
  };
}

function countMathDelimiters(line: string): number {
  return line.split('$$').length - 1;
}

function readFence(line: string): OpenFence | null {
  const match = FENCE_PATTERN.exec(line);
  return match ? { marker: match[1][0], length: match[1].length } : null;
}

function closesFence(open: OpenFence, candidate: OpenFence, line: string): boolean {
  if (candidate.marker !== open.marker || candidate.length < open.length) {
    return false;
  }
  // A closing fence carries no info string.
  return line.trim().replace(/^[`~]+/, '').trim() === '';
}

function previousNonBlank(lines: string[], from: number): number | null {
  for (let index = from - 1; index >= 0; index--) {
    if (lines[index].trim() !== '') {
      return index;
    }
  }
  return null;
}

function nextNonBlank(lines: string[], from: number): number | null {
  for (let index = from + 1; index < lines.length; index++) {
    if (lines[index].trim() !== '') {
      return index;
    }
  }
  return null;
}
