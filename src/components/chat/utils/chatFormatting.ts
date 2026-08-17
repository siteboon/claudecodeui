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

// Regions the escape-sequence pass below must not touch: code (a literal `\t`
// there is content, not markup) and math (where `\text`/`\theta`/`\rho` would be
// shredded into control characters). Single-`$` spans are deliberately NOT math —
// `$200k … $100k` prose would otherwise be swallowed as one equation.
const PROTECTED_BLOCK = /```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g;

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

  let processedText = text.replace(PROTECTED_BLOCK, (match) => {
    const index = blocks.length;
    if (match.startsWith('\\[') || match.startsWith('\\(')) {
      // remark-math only understands dollar delimiters, so rewrite the LaTeX ones;
      // otherwise the equation leaks onto the page as literal text.
      blocks.push('$$' + match.slice(2, -2) + '$$');
    } else if (match.startsWith('$$')) {
      blocks.push(match);
    } else {
      // Code: keep the legacy `\n` expansion (JSON-ish output relies on it).
      blocks.push(match.replace(/\\n/g, '\n'));
    }
    return `${placeholderPrefix}${index}${placeholderSuffix}`;
  });

  // Only `\n`. `\t`/`\r` collided with real LaTeX commands (`\text`, `\times`,
  // `\rho`, `\right`) and Windows paths (`C:\temp`), corrupting far more than they
  // fixed — a leading TAB even turned an equation into an indented code block.
  processedText = processedText.replace(/\\n/g, '\n');

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
