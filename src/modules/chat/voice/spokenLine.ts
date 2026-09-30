/**
 * The spoken line of a reply: a closing `<spoken>…</spoken>` block the model
 * writes at the end of its answer under a CLAUDE.md contract (one or two
 * sentences for the ear, no code, no paths, numbers as words).
 *
 * Two jobs, both pure:
 *  - `extractSpokenLine` decides whether the reply carries a line that may be
 *    sent to speech. Only the LAST block counts, and only when nothing but
 *    whitespace follows it; anything that looks like code, a path or a digit
 *    sequence is rejected rather than read aloud.
 *  - `stripSpokenBlocks` removes every block from what the transcript shows and
 *    what Copy puts on the clipboard - always, whether or not voice is on, and a
 *    rejected block included. Once a session has seen the contract the model
 *    keeps writing the block after voice is switched off.
 */

export type SpokenLineRejection = 'trailing_text' | 'code' | 'path' | 'digits' | 'empty' | 'too_long';

export type SpokenLineResult =
  | { status: 'valid'; line: string }
  | { status: 'missing'; line: null }
  | { status: 'rejected'; line: null; reason: SpokenLineRejection };

const OPEN = '<spoken>';
const CLOSE = '</spoken>';

/** A line longer than this is not a one-to-two sentence summary; the voice service caps at 300 too. */
export const SPOKEN_LINE_MAX_CHARS = 300;

const BLOCK_RE = /<spoken>([\s\S]*?)<\/spoken>/g;
const FENCE_RE = /^[ \t]*(```|~~~)/;

const hasCode = (line: string) => line.includes('`');
// A slash or backslash never belongs in a Czech sentence meant for the ear, and a
// word glued to a short extension (`index.tsx`, `app.ts`) is a file name.
const hasPath = (line: string) => /[\\/]/.test(line) || /\b[\w-]+\.[A-Za-z][A-Za-z0-9]{0,4}\b/.test(line);
const hasDigits = (line: string) => /\d/.test(line);

/** Character ranges of fenced code blocks, so a block quoted inside one is left alone. */
function fencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  let openAt: number | null = null;
  for (const line of text.split('\n')) {
    if (FENCE_RE.test(line)) {
      if (openAt === null) {
        openAt = offset;
      } else {
        ranges.push([openAt, offset + line.length]);
        openAt = null;
      }
    }
    offset += line.length + 1;
  }
  if (openAt !== null) ranges.push([openAt, text.length]);
  return ranges;
}

const insideAny = (at: number, ranges: Array<[number, number]>) => ranges.some(([a, b]) => at >= a && at <= b);

/** Every complete block outside fenced code: [start, end, inner text]. */
function findBlocks(text: string): Array<{ start: number; end: number; inner: string }> {
  const ranges = fencedRanges(text);
  const blocks: Array<{ start: number; end: number; inner: string }> = [];
  for (const match of text.matchAll(BLOCK_RE)) {
    const start = match.index ?? 0;
    if (insideAny(start, ranges)) continue;
    blocks.push({ start, end: start + match[0].length, inner: match[1] });
  }
  return blocks;
}

export function extractSpokenLine(text: string | null | undefined): SpokenLineResult {
  const source = String(text || '');
  const blocks = findBlocks(source);
  if (blocks.length === 0) return { status: 'missing', line: null };

  const last = blocks[blocks.length - 1];
  if (source.slice(last.end).trim().length > 0) {
    return { status: 'rejected', line: null, reason: 'trailing_text' };
  }

  const line = last.inner.replace(/\s+/g, ' ').trim();
  if (!line) return { status: 'rejected', line: null, reason: 'empty' };
  if (hasCode(line)) return { status: 'rejected', line: null, reason: 'code' };
  if (hasPath(line)) return { status: 'rejected', line: null, reason: 'path' };
  if (hasDigits(line)) return { status: 'rejected', line: null, reason: 'digits' };
  if (line.length > SPOKEN_LINE_MAX_CHARS) return { status: 'rejected', line: null, reason: 'too_long' };
  return { status: 'valid', line };
}

/** Longest suffix of `text` that is a proper prefix of the opening tag (`<`, `<sp`, …). */
function partialOpenTagAtEnd(text: string): number {
  for (let n = Math.min(OPEN.length, text.length); n > 0; n -= 1) {
    if (OPEN.startsWith(text.slice(text.length - n))) return n;
  }
  return 0;
}

export function stripSpokenBlocks(text: string, options: { streaming?: boolean } = {}): string {
  if (!text || !text.includes('<')) return text;

  let out = text;
  let changed = false;

  // Complete blocks, from the end so earlier offsets stay valid.
  const blocks = findBlocks(out);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    out = out.slice(0, blocks[i].start) + out.slice(blocks[i].end);
    changed = true;
  }

  // An opening tag that never closed (the model is still writing it, or stopped
  // mid-block): hide it and everything after it, unless it sits in a code fence.
  const lastOpen = out.lastIndexOf(OPEN);
  if (lastOpen !== -1 && !out.includes(CLOSE, lastOpen) && !insideAny(lastOpen, fencedRanges(out))) {
    out = out.slice(0, lastOpen);
    changed = true;
  } else if (options.streaming) {
    // While streaming, the tag itself can be half-written: `<`, `<spo`.
    const partial = partialOpenTagAtEnd(out);
    if (partial > 0) {
      out = out.slice(0, out.length - partial);
      changed = true;
    }
  }

  return changed ? out.replace(/\s+$/, '') : text;
}
