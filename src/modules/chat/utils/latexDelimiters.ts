/**
 * Rewrites the LaTeX math delimiters `\(…\)` and `\[…\]` into the `$$…$$` form
 * that remark-math actually understands.
 *
 * Models — Codex in particular — emit math with the LaTeX delimiters, but
 * `micromark-extension-math`, which backs remark-math, registers exactly one
 * construct and it sits on `$`. Nothing recognizes `\(`, and because CommonMark
 * reads `\(` and `\[` as backslash escapes the parser eats the backslash, so the
 * reader is left with `(x = …)` instead of a formula.
 *
 * `$$` is the target for both notations because `singleDollarTextMath` is off in
 * <Markdown>, deliberately: a lone `$` must never open math or a sentence like
 * "costs $5 and $7" becomes a formula. A `$$…$$` run inside a paragraph is
 * inline math and a `$$` alone on its line opens a display block, so both
 * notations survive the translation.
 *
 * Code is never rewritten: fenced blocks, indented blocks and inline code spans
 * are masked out before any delimiter is matched, so LaTeX quoted as an example
 * stays literal.
 */

/** An opening or closing code fence, per CommonMark: up to 3 spaces of indent. */
const CODE_FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

/** The indent that starts an indented code block where a block may begin. */
const INDENTED_CODE_PATTERN = /^(?: {4}|\t)/;

/**
 * Every delimiter candidate. `\\` is matched first and discarded so a literal
 * escaped backslash (`\\(`) is never read as an opener.
 */
const LATEX_DELIMITER_PATTERN = /\\\\|\\[()[\]]/g;

/** Cheap bail-out: no opener, nothing to do. Runs on every rendered message. */
const LATEX_OPENER_PATTERN = /\\[([]/;

/** A blank line, which would end the paragraph a `$$…$$` inline run lives in. */
const BLANK_LINE_PATTERN = /\n[ \t]*\n/;

/**
 * Used by streamingMarkdown's boundary search: the line that opens a `\[ … \]`
 * display block, i.e. exactly the block normalizeLatexDelimiters turns into a
 * `$$` fence. The splitter must not cut inside one, or the two halves normalize
 * independently and each renders a stray bracket.
 */
export const LATEX_DISPLAY_OPEN_PATTERN = /^ {0,3}\\\[/;

/** Used by streamingMarkdown: the `\]` that closes such a block, anywhere on the line. */
export const LATEX_DISPLAY_CLOSE_PATTERN = /\\\]/;

type LatexDelimiter = {
  index: number;
  /** The bracket after the backslash, which says whether this opens or closes. */
  bracket: '(' | ')' | '[' | ']';
};

/** A slice of the source to overwrite, in ascending, non-overlapping order. */
type DelimiterEdit = { start: number; end: number; value: string };

/**
 * Used by chat's <Markdown> on every message body, after
 * normalizeInlineCodeFences has settled the code spans this reads.
 */
export function normalizeLatexDelimiters(text: string): string {
  if (!text || typeof text !== 'string' || !LATEX_OPENER_PATTERN.test(text)) {
    return text;
  }
  try {
    const codeMask = buildCodeMask(text);
    const edits = planDelimiterEdits(text, codeMask);
    if (edits.length === 0) {
      return text;
    }

    let result = '';
    let cursor = 0;
    for (const edit of edits) {
      result += text.slice(cursor, edit.start) + edit.value;
      cursor = edit.end;
    }
    return result + text.slice(cursor);
  } catch {
    return text;
  }
}

/**
 * Marks every character that CommonMark reads as code, so no delimiter inside
 * one is rewritten. Deliberately over-eager in one spot: an indented paragraph
 * inside a loose list is counted as indented code, which only means the LaTeX
 * there stays literal — never that prose is mangled.
 */
function buildCodeMask(text: string): Uint8Array {
  const mask = new Uint8Array(text.length);

  let offset = 0;
  let openFence: { marker: string; length: number } | null = null;
  // A blank line (or the document start) is what lets an indented code block begin.
  let blockCanStart = true;
  let inIndentedCode = false;

  for (const line of text.split('\n')) {
    const fence = CODE_FENCE_PATTERN.exec(line);
    let isCode = false;

    if (openFence) {
      isCode = true;
      if (fence && closesFence(openFence, fence[1], line)) {
        openFence = null;
      }
    } else if (fence) {
      openFence = { marker: fence[1][0], length: fence[1].length };
      isCode = true;
      inIndentedCode = false;
      blockCanStart = false;
    } else if (line.trim() === '') {
      blockCanStart = true;
    } else if ((blockCanStart || inIndentedCode) && INDENTED_CODE_PATTERN.test(line)) {
      isCode = true;
      inIndentedCode = true;
      blockCanStart = false;
    } else {
      inIndentedCode = false;
      blockCanStart = false;
    }

    if (isCode) {
      mask.fill(1, offset, offset + line.length);
    }
    offset += line.length + 1;
  }

  maskInlineCodeSpans(text, mask);
  return mask;
}

/** A closing fence uses the same marker, is at least as long and carries no info string. */
function closesFence(open: { marker: string; length: number }, sequence: string, line: string): boolean {
  if (sequence[0] !== open.marker || sequence.length < open.length) {
    return false;
  }
  return line.trim().replace(/^[`~]+/, '').trim() === '';
}

/** Adds each `` ` ``-delimited span outside a code block to the mask. */
function maskInlineCodeSpans(text: string, mask: Uint8Array): void {
  let index = 0;
  while (index < text.length) {
    if (mask[index] || text[index] !== '`') {
      index += 1;
      continue;
    }
    const runEnd = endOfBacktickRun(text, index);
    const closeAt = findBacktickRun(text, runEnd, runEnd - index, mask);
    if (closeAt < 0) {
      // No matching run: CommonMark leaves the backticks as literal text.
      index = runEnd;
      continue;
    }
    const spanEnd = closeAt + (runEnd - index);
    mask.fill(1, index, spanEnd);
    index = spanEnd;
  }
}

function endOfBacktickRun(text: string, from: number): number {
  let index = from;
  while (index < text.length && text[index] === '`') {
    index += 1;
  }
  return index;
}

/** The next unmasked run of exactly `length` backticks, or -1. */
function findBacktickRun(text: string, from: number, length: number, mask: Uint8Array): number {
  let index = from;
  while (index < text.length) {
    if (mask[index] || text[index] !== '`') {
      index += 1;
      continue;
    }
    const runEnd = endOfBacktickRun(text, index);
    if (runEnd - index === length) {
      return index;
    }
    index = runEnd;
  }
  return -1;
}

/** Pairs the delimiters left outside code and turns each pair into `$$` edits. */
function planDelimiterEdits(text: string, mask: Uint8Array): DelimiterEdit[] {
  const delimiters: LatexDelimiter[] = [];
  LATEX_DELIMITER_PATTERN.lastIndex = 0;
  for (let match = LATEX_DELIMITER_PATTERN.exec(text); match; match = LATEX_DELIMITER_PATTERN.exec(text)) {
    if (match[0] !== '\\\\' && !mask[match.index]) {
      delimiters.push({ index: match.index, bracket: match[0][1] as LatexDelimiter['bracket'] });
    }
  }

  const edits: DelimiterEdit[] = [];
  let position = 0;
  while (position < delimiters.length) {
    const open = delimiters[position];
    if (open.bracket !== '(' && open.bracket !== '[') {
      position += 1;
      continue;
    }

    const closingBracket = open.bracket === '(' ? ')' : ']';
    let closePosition = -1;
    for (let candidate = position + 1; candidate < delimiters.length; candidate += 1) {
      if (delimiters[candidate].bracket === closingBracket) {
        closePosition = candidate;
        break;
      }
    }
    if (closePosition < 0) {
      // An unmatched opener is ordinary text (a Windows path, an escaped bracket).
      position += 1;
      continue;
    }

    const close = delimiters[closePosition];
    const content = text.slice(open.index + 2, close.index);
    // A `$$` inside would close the run being opened, and a code region between
    // the two delimiters means they are not really a pair.
    if (content.includes('$$') || spansCode(mask, open.index, close.index)) {
      position += 1;
      continue;
    }

    // `\[` already at the start of its line becomes a `$$` fence, which is what
    // makes it a centered display equation; anywhere else it has to stay inline
    // so the surrounding list item, table cell or sentence is not torn apart.
    const isDisplayBlock = open.bracket === '[' && startsLine(text, open.index);
    if (isDisplayBlock) {
      edits.push({
        start: open.index,
        end: open.index + 2,
        value: restOfLineIsBlank(text, open.index + 2) ? '$$' : '$$\n',
      });
      edits.push({
        start: close.index,
        end: close.index + 2,
        value: startsLine(text, close.index) ? '$$' : '\n$$',
      });
    } else if (BLANK_LINE_PATTERN.test(content)) {
      // Inline math cannot cross a paragraph break; leave the pair alone.
      position += 1;
      continue;
    } else {
      // The spaces are stripped again by micromark, and they keep a `$` at the
      // edge of the formula from lengthening the delimiter run.
      edits.push({ start: open.index, end: open.index + 2, value: '$$ ' });
      edits.push({ start: close.index, end: close.index + 2, value: ' $$' });
    }

    position = closePosition + 1;
  }

  return edits;
}

function spansCode(mask: Uint8Array, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (mask[index]) {
      return true;
    }
  }
  return false;
}

/** Only whitespace sits between the start of the line and `index`. */
function startsLine(text: string, index: number): boolean {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const character = text[cursor];
    if (character === '\n') {
      return true;
    }
    if (character !== ' ' && character !== '\t') {
      return false;
    }
  }
  return true;
}

/** Only whitespace sits between `from` and the end of its line. */
function restOfLineIsBlank(text: string, from: number): boolean {
  for (let cursor = from; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === '\n') {
      return true;
    }
    if (character !== ' ' && character !== '\t') {
      return false;
    }
  }
  return true;
}
