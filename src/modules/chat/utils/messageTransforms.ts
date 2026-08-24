import type { DiffCalculator, DiffLine, DiffStats } from '@/shared/types';

/**
 * Splits a file's text into the lines a diff should compare.
 *
 * Two conventions matter, and the plain `split('\n')` this replaced got both
 * wrong:
 *
 * - **An empty string is a file with no lines, not one blank line.** `Write`
 *   passes `''` as the "before" for a file that did not exist, so every new
 *   file used to report one deleted line and draw a stray blank red row.
 * - **A trailing newline terminates the last line rather than starting an
 *   empty one**, which is how `diff`, `git` and every editor count lines.
 *   Without this, whether a file ends in a newline changed its line count.
 */
const toDiffLines = (text: string): string[] => {
  if (text === '') {
    return [];
  }

  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
};

export const calculateDiff = (oldStr: string, newStr: string): DiffLine[] => {
  const oldLines = toDiffLines(oldStr);
  const newLines = toDiffLines(newStr);

  // Use LCS alignment so insertions/deletions don't cascade into a full-file "changed" diff.
  const lcsTable: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        lcsTable[oldIndex][newIndex] = lcsTable[oldIndex + 1][newIndex + 1] + 1;
      } else {
        lcsTable[oldIndex][newIndex] = Math.max(
          lcsTable[oldIndex + 1][newIndex],
          lcsTable[oldIndex][newIndex + 1],
        );
      }
    }
  }

  const diffLines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldLine === newLine) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }

    if (lcsTable[oldIndex + 1][newIndex] >= lcsTable[oldIndex][newIndex + 1]) {
      diffLines.push({ type: 'removed', content: oldLine, lineNum: oldIndex + 1 });
      oldIndex += 1;
      continue;
    }

    diffLines.push({ type: 'added', content: newLine, lineNum: newIndex + 1 });
    newIndex += 1;
  }

  while (oldIndex < oldLines.length) {
    diffLines.push({ type: 'removed', content: oldLines[oldIndex], lineNum: oldIndex + 1 });
    oldIndex += 1;
  }

  while (newIndex < newLines.length) {
    diffLines.push({ type: 'added', content: newLines[newIndex], lineNum: newIndex + 1 });
    newIndex += 1;
  }

  return diffLines;
};

/**
 * Counts a diff's added and removed lines for the `+12 -3` badge.
 *
 * Kept next to `calculateDiff` because the counts are only as correct as its
 * line splitting: it emits changed lines only, never context, so every entry
 * is one side or the other.
 */
export const summarizeDiff = (diffLines: DiffLine[]): DiffStats => {
  let added = 0;
  let removed = 0;

  for (const diffLine of diffLines) {
    if (diffLine.type === 'added') {
      added += 1;
    } else {
      removed += 1;
    }
  }

  return { added, removed };
};

/**
 * Reads a tool call's arguments off a `ChatMessage`.
 *
 * `normalizedToChatMessages` serializes `toolInput` to a JSON string on every
 * row (`useChatMessages.ts`), so anything reading it has to parse first.
 * `ToolRenderer` did that inline and the tool-group header did not, which is
 * why per-card diff stats rendered and the group total silently did not.
 */
export const parseToolPayload = (payload: unknown): unknown => {
  if (typeof payload !== 'string') {
    return payload;
  }

  try {
    return JSON.parse(payload);
  } catch {
    // A non-JSON string is the payload — some tools take a bare command.
    return payload;
  }
};

export const createCachedDiffCalculator = (): DiffCalculator => {
  const cache = new Map<string, DiffLine[]>();

  return (oldStr: string, newStr: string) => {
    const key = JSON.stringify([oldStr, newStr]);
    const cached = cache.get(key);
    if (cached) {
      return cached;
    }

    const calculated = calculateDiff(oldStr, newStr);
    cache.set(key, calculated);
    if (cache.size > 100) {
      const firstKey = cache.keys().next().value;
      if (firstKey) {
        cache.delete(firstKey);
      }
    }
    return calculated;
  };
};
