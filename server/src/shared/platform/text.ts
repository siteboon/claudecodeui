import type { LineEnding, SplitLinesOptions } from './types.js';

// This constant is the UTF-8 byte order mark represented as a JavaScript string.
const UTF8_BOM = '\uFEFF';

// This helper removes a UTF-8 BOM because it breaks parsers that expect plain text or JSON at byte zero.
export function stripUtf8Bom(value: string): string {
  return value.startsWith(UTF8_BOM) ? value.slice(1) : value;
}

// This helper turns any mixture of CRLF, LF, or legacy CR endings into one explicit target format.
export function normalizeLineEndings(value: string, target: LineEnding = 'lf'): string {
  const withoutBom = stripUtf8Bom(value);
  const asLf = withoutBom.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  return target === 'crlf' ? asLf.replace(/\n/g, '\r\n') : asLf;
}

// This helper infers the dominant file style so later writes can preserve the existing convention.
export function detectLineEnding(value: string): LineEnding {
  return value.includes('\r\n') ? 'crlf' : 'lf';
}

// This helper splits text into logical lines after normalizing line endings first.
export function splitLines(value: string, options: SplitLinesOptions = {}): string[] {
  const { preserveEmptyLines = true, trimTrailingEmptyLine = false } = options;
  const normalized = normalizeLineEndings(value, 'lf');
  const lines = normalized.split('\n');
  const trimmedLines =
    trimTrailingEmptyLine && lines.at(-1) === ''
      ? lines.slice(0, -1)
      : lines;

  return preserveEmptyLines ? trimmedLines : trimmedLines.filter((line) => line.length > 0);
}

// This helper gives parsers one stable newline format regardless of the source operating system.
export function normalizeTextForParsing(value: string): string {
  return normalizeLineEndings(value, 'lf');
}

// This helper prepares text for file output when the caller wants to force a specific line-ending style.
export function normalizeTextForFileWrite(value: string, lineEnding: LineEnding): string {
  return normalizeLineEndings(value, lineEnding);
}

// This helper keeps file rewrites stable by reusing the line-ending style already present on disk.
export function preserveExistingLineEndings(nextText: string, currentText: string): string {
  return normalizeTextForFileWrite(nextText, detectLineEnding(currentText));
}

// This helper converts pasted or synthetic input into the carriage-return form PTYs expect for Enter.
export function normalizeTerminalInput(value: string): string {
  return stripUtf8Bom(value).replace(/\r\n|\n|\r/g, '\r');
}
