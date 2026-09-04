/**
 * Minimal JSONC reader for OpenCode's configuration file.
 *
 * OpenCode reads `opencode.jsonc` as well as `opencode.json`, so comments and
 * trailing commas have to be removed before `JSON.parse` sees the text.
 * A regular expression cannot do it: `"baseURL": "http://127.0.0.1:11434/v1"`
 * carries a `//` that must survive. This walks the text once and only treats a
 * comment or a comma as syntax while outside of a string.
 */

/** Removes `//` and block comments, keeping everything inside string literals. */
function stripComments(text: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        out += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      out += char;
      if (char === '\\') {
        // An escape takes the next character with it, `\"` included.
        out += next ?? '';
        index += 1;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    out += char;
  }

  return out;
}

/** Drops a comma that is followed by `}` or `]`, again ignoring strings. */
function stripTrailingCommas(text: string): string {
  let out = '';
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      out += char;
      if (char === '\\') {
        out += text[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ',') {
      const rest = text.slice(index + 1);
      const nextMeaningful = rest.match(/^\s*([}\]])/);
      if (nextMeaningful) {
        continue;
      }
    }

    out += char;
  }

  return out;
}

/** Parsed value, or `null` when the text is not valid JSON/JSONC. */
export function parseJsonc<T>(text: string): T | null {
  try {
    return JSON.parse(stripTrailingCommas(stripComments(text))) as T;
  } catch {
    return null;
  }
}
