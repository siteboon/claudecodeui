import path from 'node:path';

type FileDiffFileSystem = Pick<typeof import('node:fs/promises'), 'open' | 'stat'>;

type FileDiffSpawnProcess = typeof import('cross-spawn');

type ReadWorkingTreeFileDiffInput = {
  repositoryRootPath: string;
  repositoryRelativeFilePath: string;
  fileSystem: FileDiffFileSystem;
  spawnProcess: FileDiffSpawnProcess;
};

/** `/api/git/diff` payload. `diff` keeps its original meaning; the flags say what was left out of it. */
type WorkingTreeFileDiff = {
  diff: string;
  isBinary: boolean;
  isTruncated: boolean;
};

type BoundedBytes = {
  bytes: Buffer;
  isTruncated: boolean;
};

// Most bytes one diff request may read from a file or from git's stdout.
// This matches the commit-diff budget and is well above what GitDiffViewer
// renders (200K characters / 1,500 lines), so the visible preview is unchanged.
const FILE_DIFF_BYTE_LIMIT = 500_000;

// Git's own heuristic (buffer_is_binary): a NUL byte in the first 8000 bytes.
const BINARY_SNIFF_BYTE_COUNT = 8_000;

const BINARY_DIFF_LINE_PATTERN = /^Binary files .* differ$/m;

function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, BINARY_SNIFF_BYTE_COUNT).includes(0);
}

// Byte length of the UTF-8 sequence that `leadByte` starts (1 for ASCII and stray bytes).
function utf8SequenceLength(leadByte: number): number {
  if (leadByte >= 0xf0) return 4;
  if (leadByte >= 0xe0) return 3;
  if (leadByte >= 0xc0) return 2;
  return 1;
}

// A truncated read can stop inside a multi-byte UTF-8 character, which would
// decode as U+FFFD, so only that incomplete character is dropped. The partial
// last line itself is kept: backing up to the previous newline would leave a
// long single-line file (a minified bundle) with no preview at all.
function decodeBoundedText({ bytes, isTruncated }: BoundedBytes): string {
  if (!isTruncated) {
    return bytes.toString('utf8');
  }

  // Walk back over at most three continuation bytes (10xxxxxx) to the lead byte.
  let leadByteIndex = bytes.length - 1;
  while (leadByteIndex > 0 && bytes.length - leadByteIndex < 4 && (bytes[leadByteIndex] & 0xc0) === 0x80) {
    leadByteIndex -= 1;
  }
  const endsMidCharacter = leadByteIndex >= 0
    && bytes.length - leadByteIndex < utf8SequenceLength(bytes[leadByteIndex]);
  return bytes.subarray(0, endsMidCharacter ? leadByteIndex : bytes.length).toString('utf8');
}

/** Runs git and keeps at most `byteLimit` bytes of stdout, stopping git once the limit is passed. */
function runGitWithBoundedOutput(
  spawnProcess: FileDiffSpawnProcess,
  args: string[],
  cwd: string,
  byteLimit: number,
): Promise<BoundedBytes> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('git', args, { cwd, shell: false });
    const chunks: Buffer[] = [];
    let byteCount = 0;
    let isTruncated = false;
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      if (isTruncated) {
        return;
      }

      const remainingBytes = byteLimit - byteCount;
      if (chunk.length > remainingBytes) {
        chunks.push(chunk.subarray(0, remainingBytes));
        byteCount = byteLimit;
        isTruncated = true;
        // Everything past the limit would be discarded anyway.
        child.kill();
        return;
      }

      chunks.push(chunk);
      byteCount += chunk.length;
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code: number | null) => {
      // A kill we triggered after the limit is expected, not a git failure.
      if (code === 0 || isTruncated) {
        resolve({ bytes: Buffer.concat(chunks), isTruncated });
        return;
      }

      reject(Object.assign(new Error(`Command failed: git ${args.join(' ')}`), {
        code,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr,
      }));
    });
  });
}

/** Reads at most `byteLimit` bytes from the start of a file whose size is already known. */
async function readFileHead(
  fileSystem: FileDiffFileSystem,
  filePath: string,
  fileSize: number,
  byteLimit: number,
): Promise<BoundedBytes> {
  const bytes = Buffer.alloc(Math.min(fileSize, byteLimit));
  const fileHandle = await fileSystem.open(filePath, 'r');

  try {
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await fileHandle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }

    return { bytes: bytes.subarray(0, offset), isTruncated: fileSize > byteLimit };
  } finally {
    await fileHandle.close();
  }
}

// Strips the diff --git / index / mode / ---/+++ headers, keeping hunks onward.
function stripDiffHeaders(diff: string): string {
  if (!diff) return '';

  const lines = diff.split('\n');
  const filteredLines: string[] = [];
  let startIncluding = false;

  for (const line of lines) {
    // Skip all header lines including diff --git, index, file mode, and --- / +++ file paths
    if (line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode') ||
        line.startsWith('---') ||
        line.startsWith('+++')) {
      continue;
    }

    // Start including lines from @@ hunk headers onwards
    if (line.startsWith('@@') || startIncluding) {
      startIncluding = true;
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

// Renders a whole file as one hunk of additions (untracked) or deletions (deleted).
function prefixEveryLine(content: string, prefix: '+' | '-'): { lineCount: number; body: string } {
  const lines = content.split('\n');
  return { lineCount: lines.length, body: lines.map((line) => `${prefix}${line}`).join('\n') };
}

async function readUntrackedFileDiff(input: ReadWorkingTreeFileDiffInput): Promise<WorkingTreeFileDiff> {
  const { repositoryRootPath, repositoryRelativeFilePath, fileSystem } = input;
  const filePath = path.join(repositoryRootPath, repositoryRelativeFilePath);
  const stats = await fileSystem.stat(filePath);

  if (stats.isDirectory()) {
    return {
      diff: `Directory: ${repositoryRelativeFilePath}\n(Cannot show diff for directories)`,
      isBinary: false,
      isTruncated: false,
    };
  }

  const head = await readFileHead(fileSystem, filePath, stats.size, FILE_DIFF_BYTE_LIMIT);
  if (looksBinary(head.bytes)) {
    return { diff: '', isBinary: true, isTruncated: false };
  }

  const { lineCount, body } = prefixEveryLine(decodeBoundedText(head), '+');
  return {
    diff: `--- /dev/null\n+++ b/${repositoryRelativeFilePath}\n@@ -0,0 +1,${lineCount} @@\n${body}`,
    isBinary: false,
    isTruncated: head.isTruncated,
  };
}

async function readDeletedFileDiff(input: ReadWorkingTreeFileDiffInput): Promise<WorkingTreeFileDiff> {
  const { repositoryRootPath, repositoryRelativeFilePath, spawnProcess } = input;
  const headContent = await runGitWithBoundedOutput(
    spawnProcess,
    ['show', `HEAD:${repositoryRelativeFilePath}`],
    repositoryRootPath,
    FILE_DIFF_BYTE_LIMIT,
  );

  if (looksBinary(headContent.bytes)) {
    return { diff: '', isBinary: true, isTruncated: false };
  }

  const { lineCount, body } = prefixEveryLine(decodeBoundedText(headContent), '-');
  return {
    diff: `--- a/${repositoryRelativeFilePath}\n+++ /dev/null\n@@ -1,${lineCount} +0,0 @@\n${body}`,
    isBinary: false,
    isTruncated: headContent.isTruncated,
  };
}

async function readTrackedFileDiff(input: ReadWorkingTreeFileDiffInput): Promise<WorkingTreeFileDiff> {
  const { repositoryRootPath, repositoryRelativeFilePath, spawnProcess } = input;

  // Unstaged changes (working tree vs index) win; fall back to staged ones (index vs HEAD).
  let gitDiff = await runGitWithBoundedOutput(
    spawnProcess,
    ['diff', '--', repositoryRelativeFilePath],
    repositoryRootPath,
    FILE_DIFF_BYTE_LIMIT,
  );
  if (gitDiff.bytes.length === 0) {
    gitDiff = await runGitWithBoundedOutput(
      spawnProcess,
      ['diff', '--cached', '--', repositoryRelativeFilePath],
      repositoryRootPath,
      FILE_DIFF_BYTE_LIMIT,
    );
  }

  const rawDiff = decodeBoundedText(gitDiff);
  const diff = stripDiffHeaders(rawDiff);
  // git prints "Binary files a/x and b/x differ" instead of hunks for binaries.
  if (!diff && BINARY_DIFF_LINE_PATTERN.test(rawDiff)) {
    return { diff: '', isBinary: true, isTruncated: false };
  }

  return { diff, isBinary: false, isTruncated: gitDiff.isTruncated };
}

/**
 * Used by the Git routes module (`GET /api/git/diff`) to build one changed file's diff
 * without ever holding more than a bounded slice of it in memory: binary files are
 * detected and skipped, and oversized files/diffs are cut with `isTruncated` set.
 */
export async function readWorkingTreeFileDiff(input: ReadWorkingTreeFileDiffInput): Promise<WorkingTreeFileDiff> {
  const status = decodeBoundedText(await runGitWithBoundedOutput(
    input.spawnProcess,
    ['status', '--porcelain', '--', input.repositoryRelativeFilePath],
    input.repositoryRootPath,
    FILE_DIFF_BYTE_LIMIT,
  ));
  const isUntracked = status.startsWith('??');
  const isDeleted = status.trim().startsWith('D ') || status.trim().startsWith(' D');

  if (isUntracked) {
    return readUntrackedFileDiff(input);
  }
  if (isDeleted) {
    return readDeletedFileDiff(input);
  }
  return readTrackedFileDiff(input);
}
