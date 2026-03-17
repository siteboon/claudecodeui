import { stripUtf8Bom } from './text.js';
import type { StreamLineAccumulator, StreamLineAccumulatorOptions } from './types.js';

// This helper keeps the push logic focused on line extraction rather than Buffer/string branching.
function chunkToString(chunk: Buffer | string): string {
  return Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
}

// This helper lets callers reuse the same cross-platform line parser for stdout, stderr, or file streams.
export function createStreamLineAccumulator(
  options: StreamLineAccumulatorOptions = {},
): StreamLineAccumulator {
  const { preserveEmptyLines = true } = options;
  let buffer = '';
  let isFirstChunk = true;

  // This helper applies BOM stripping only once because a stream can only start once.
  const normalizeIncomingChunk = (chunk: Buffer | string): string => {
    const text = chunkToString(chunk);

    if (!isFirstChunk) {
      return text;
    }

    isFirstChunk = false;
    return stripUtf8Bom(text);
  };

  // This helper enforces the caller's empty-line policy in one place.
  const maybeAppendLine = (lines: string[], line: string): void => {
    if (preserveEmptyLines || line.length > 0) {
      lines.push(line);
    }
  };

  return {
    // This method extracts only complete lines and keeps an incomplete trailing fragment in memory.
    push: (chunk: Buffer | string): string[] => {
      buffer += normalizeIncomingChunk(chunk);
      const lines: string[] = [];
      let lineStartIndex = 0;
      let cursor = 0;

      while (cursor < buffer.length) {
        const currentCharacter = buffer[cursor];

        if (currentCharacter === '\n') {
          maybeAppendLine(lines, buffer.slice(lineStartIndex, cursor));
          cursor += 1;
          lineStartIndex = cursor;
          continue;
        }

        if (currentCharacter === '\r') {
          // A trailing carriage return may be the first half of a CRLF sequence from the next chunk.
          if (cursor === buffer.length - 1) {
            break;
          }

          maybeAppendLine(lines, buffer.slice(lineStartIndex, cursor));
          cursor += buffer[cursor + 1] === '\n' ? 2 : 1;
          lineStartIndex = cursor;
          continue;
        }

        cursor += 1;
      }

      buffer = buffer.slice(lineStartIndex);
      return lines;
    },

    // This method flushes the final unterminated fragment when the stream closes.
    flush: (): string[] => {
      if (buffer === '') {
        return [];
      }

      const trailingLine = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      buffer = '';

      if (!preserveEmptyLines && trailingLine.length === 0) {
        return [];
      }

      return [trailingLine];
    },

    // This method exposes the buffered partial fragment for diagnostics or advanced callers.
    peek: (): string => buffer,

    // This method resets the parser so a caller can reuse the same object for a new stream.
    reset: (): void => {
      buffer = '';
      isFirstChunk = true;
    },
  };
}
