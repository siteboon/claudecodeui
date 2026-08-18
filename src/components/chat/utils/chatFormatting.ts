export function decodeHtmlEntities(text: string) {
  if (!text) return text;
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function normalizeInlineCodeFences(text: string) {
  if (!text || typeof text !== 'string') return text;
  try {
    return text.replace(/```[ \t]*([^\n\r]+?)[ \t]*```/g, '`$1`');
  } catch {
    return text;
  }
}

// Regions the escape-sequence pass below must not touch: code (except for the
// intentional legacy `\n` normalization) and math (where `\text`/`\theta`/`\rho`
// would be shredded into control characters). Single-`$` spans are deliberately
// NOT math — `$200k … $100k` prose would otherwise be swallowed as one equation.
type ProtectedBlock = {
  end: number;
  value: string;
  type: 'code' | 'math' | 'latex';
};
const MATH_DELIMITERS = [
  { opening: '$$', closing: '$$', type: 'math' as const },
  { opening: '\\[', closing: '\\]', type: 'latex' as const },
  { opening: '\\(', closing: '\\)', type: 'latex' as const },
];

function findLineEnd(text: string, start: number) {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '\n' || text[index] === '\r') return index;
  }
  return text.length;
}

function findNextLineStart(text: string, lineEnd: number) {
  if (lineEnd >= text.length) return lineEnd;
  if (text[lineEnd] === '\r' && text[lineEnd + 1] === '\n') return lineEnd + 2;
  return lineEnd + 1;
}

function countDelimiter(text: string, start: number, delimiter: string) {
  let end = start;
  while (text[end] === delimiter) end += 1;
  return end - start;
}

function findFencedCodeAt(text: string, start: number): ProtectedBlock | null {
  if (start > 0 && text[start - 1] !== '\n' && text[start - 1] !== '\r') return null;

  let markerStart = start;
  while (markerStart - start < 3 && text[markerStart] === ' ') markerStart += 1;

  const delimiter = text[markerStart];
  if (delimiter !== '`' && delimiter !== '~') return null;

  const markerLength = countDelimiter(text, markerStart, delimiter);
  if (markerLength < 3) return null;

  const openingLineEnd = findLineEnd(text, markerStart + markerLength);
  if (openingLineEnd >= text.length) return null;
  if (delimiter === '`' && text.slice(markerStart + markerLength, openingLineEnd).includes('`')) {
    return null;
  }

  let lineStart = findNextLineStart(text, openingLineEnd);
  while (lineStart < text.length) {
    const lineEnd = findLineEnd(text, lineStart);
    let closingStart = lineStart;
    while (closingStart - lineStart < 3 && text[closingStart] === ' ') closingStart += 1;

    if (text[closingStart] === delimiter) {
      const closingLength = countDelimiter(text, closingStart, delimiter);
      const trailingText = text.slice(closingStart + closingLength, lineEnd);
      if (closingLength >= markerLength && /^[ \t]*$/.test(trailingText)) {
        const end = findNextLineStart(text, lineEnd);
        return { end, value: text.slice(start, end), type: 'code' };
      }
    }

    lineStart = findNextLineStart(text, lineEnd);
  }

  return { end: text.length, value: text.slice(start), type: 'code' };
}

function findInlineCodeAt(text: string, start: number): ProtectedBlock | null {
  if (text[start] !== '`') return null;

  const markerLength = countDelimiter(text, start, '`');
  let searchStart = start + markerLength;
  while (searchStart < text.length) {
    if (text[searchStart] !== '`') {
      searchStart += 1;
      continue;
    }

    const closingLength = countDelimiter(text, searchStart, '`');
    if (closingLength === markerLength) {
      const end = searchStart + closingLength;
      return { end, value: text.slice(start, end), type: 'code' };
    }
    searchStart += closingLength;
  }

  return null;
}

function findMathAt(text: string, start: number): ProtectedBlock | null {
  for (const { opening, closing, type } of MATH_DELIMITERS) {
    if (!text.startsWith(opening, start)) continue;
    const closingStart = text.indexOf(closing, start + opening.length);
    if (closingStart < 0) return null;
    const end = closingStart + closing.length;
    return { end, value: text.slice(start, end), type };
  }

  return null;
}

export function unescapeWithMathProtection(text: string) {
  if (!text || typeof text !== 'string') return text;

  const blocks: string[] = [];
  // Literal `__PROTECTED_BLOCK_0__` in the message would otherwise be restored as
  // block 0, replacing the user's own words. NUL can't occur in typed markdown, and
  // the loop covers even that pathological case.
  const placeholderSuffix = '\u0000';
  let placeholderPrefix = '\u0000PROTECTED_BLOCK_';
  while (text.includes(placeholderPrefix)) {
    placeholderPrefix += '_';
  }

  const processedParts: string[] = [];
  let chunkStart = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const block =
      findFencedCodeAt(text, cursor) ?? findInlineCodeAt(text, cursor) ?? findMathAt(text, cursor);
    if (!block) {
      cursor += 1;
      continue;
    }

    processedParts.push(text.slice(chunkStart, cursor));
    const index = blocks.length;
    if (block.type === 'latex') {
      // remark-math only understands dollar delimiters, so rewrite the LaTeX ones;
      // otherwise the equation leaks onto the page as literal text.
      blocks.push('$$' + block.value.slice(2, -2) + '$$');
    } else if (block.type === 'math') {
      blocks.push(block.value);
    } else {
      // Code stays protected from tab/carriage-return expansion. Legacy transcript
      // data stores code newlines as literal `\n`, so normalize those on restore.
      blocks.push(block.value.replace(/\\n/g, '\n'));
    }
    processedParts.push(`${placeholderPrefix}${index}${placeholderSuffix}`);
    cursor = block.end;
    chunkStart = cursor;
  }
  processedParts.push(text.slice(chunkStart));

  // Only `\n`. `\t`/`\r` collided with real LaTeX commands (`\text`, `\times`,
  // `\rho`, `\right`) and Windows paths (`C:\temp`), corrupting far more than they
  // fixed — a leading TAB even turned an equation into an indented code block.
  const processedText = processedParts.join('').replace(/\\n/g, '\n');

  return processedText.replace(
    new RegExp(`${placeholderPrefix}(\\d+)${placeholderSuffix}`, 'g'),
    (match, index) => blocks[parseInt(index, 10)] ?? match,
  );
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatUsageLimitText(text: string) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (match, ts) => {
      let timestampMs = parseInt(ts, 10);
      if (!Number.isFinite(timestampMs)) return match;
      if (timestampMs < 1e12) timestampMs *= 1000;
      const reset = new Date(timestampMs);

      const timeStr = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(reset);

      const offsetMinutesLocal = -reset.getTimezoneOffset();
      const sign = offsetMinutesLocal >= 0 ? '+' : '-';
      const abs = Math.abs(offsetMinutesLocal);
      const offH = Math.floor(abs / 60);
      const offM = abs % 60;
      const gmt = `GMT${sign}${offH}${offM ? ':' + String(offM).padStart(2, '0') : ''}`;
      const tzId = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const cityRaw = tzId.split('/').pop() || '';
      const city = cityRaw
        .replace(/_/g, ' ')
        .toLowerCase()
        .replace(/\b\w/g, (char) => char.toUpperCase());
      const tzHuman = city ? `${gmt} (${city})` : gmt;

      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateReadable = `${reset.getDate()} ${months[reset.getMonth()]} ${reset.getFullYear()}`;

      return `Claude usage limit reached. Your limit will reset at **${timeStr} ${tzHuman}** - ${dateReadable}`;
    });
  } catch {
    return text;
  }
}
