/**
 * Splits a partially-streamed assistant message into a settled prefix and the
 * block still being written.
 *
 * The realtime handler pushes the whole accumulated reply every 100ms, so
 * rendering it as one markdown document re-parses the entire message ten times
 * a second — O(length) per tick and O(length²) over a reply. Splitting at a
 * block boundary lets the prefix render through a memoized <Markdown>, whose
 * input only changes when a block completes, so each tick only parses the tail.
 *
 * Correctness rests on markdown blocks being independent across a blank line:
 * rendering `prefix` and `tail` as two documents must equal rendering their
 * concatenation. That does NOT hold inside a fenced code block, a list, a
 * blockquote or a table, so the boundary search skips all of them.
 */

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Block starters whose meaning depends on the surrounding lines: splitting
 * next to one would restart an ordered list, break a blockquote into two, or
 * separate a table from its header.
 */
const CONTEXT_SENSITIVE_LINE = /^(\s*([-*+]|\d+[.)])\s|\s{2,}\S|\s*>|\s*\|)/;

export type StreamingMarkdownSplit = {
  /** Complete blocks. Stable between ticks, so its markdown parse is memoizable. */
  settled: string;
  /** The block still streaming. Re-parsed every tick, but bounded by one block. */
  pending: string;
};

export function splitStreamingMarkdown(content: string): StreamingMarkdownSplit {
  if (!content) {
    return { settled: '', pending: '' };
  }

  const lines = content.split('\n');
  let insideFence = false;
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

    if (FENCE_PATTERN.test(line)) {
      insideFence = !insideFence;
      continue;
    }

    if (insideFence || line.trim() !== '') {
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
