# Cross-Platform Input Parsing Notes
## Why This Matters In This Repo
CloudCLI is not only an HTTP API plus React UI. From the README and current backend layout, it also launches CLIs, keeps interactive terminal sessions alive, reads and writes local files, parses process output, and forwards terminal input from the browser into local shells. That puts the backend on the boundary between browser input, terminal behavior, child process behavior, and filesystem behavior. Linux and Windows differ at each of those boundaries.

For the TypeScript migration, the OS adapter layer now lives in:
- [server/src/shared/platform/index.ts](/c:/Users/OMEN6/Desktop/Projects/Paid/ClaudeCodeUI%20-%20Siteboon/claudecodeui/server/src/shared/platform/index.ts)

Use those helpers in new `server/src` code so feature modules do not branch on the operating system.

## Assumptions
- The legacy runtime in `server/index.js` stays untouched for now.
- New backend code will be added under `server/src`.
- Node.js 22 is the baseline because the README already requires Node 22+.
- The main instability is text handling around shells, streams, and files, not business logic.

## Where Parsing Happens In This Repo
- `server/index.js`: PTY shell input/output and session reuse
- `server/cursor-cli.js`: streaming line-delimited JSON from `cursor-agent`
- `server/gemini-response-handler.js`: incremental parsing of Gemini JSON lines
- `server/routes/mcp.js` and `server/routes/codex.js`: parsing human-readable CLI output
- `server/cli.js` and `server/load-env.js`: parsing command-line args and `.env` text
- `server/routes/git.js` and related routes: parsing Git stdout line by line

Those are not all the same problem. In this repo, "input parsing" means terminal input parsing, stream parsing, file parsing, shell command construction, and path normalization.

## Core Terms
### Process
A process is a running program such as `node server/start.js`, `git`, `codex`, or `cursor-agent`. When your backend launches one of these, the backend is the parent process and the launched program is the child process.

### Child Process
A child process is a process started by another process. Examples:
- CloudCLI launches `git status`
- CloudCLI launches `codex mcp list`
- CloudCLI launches `cursor-agent --output-format stream-json`

Important point: a child process usually does not hand you one final string. It emits output over time.

### stdin, stdout, stderr
These are the three standard streams:
- `stdin`: data going into the process
- `stdout`: normal output coming out
- `stderr`: diagnostics, warnings, and errors

Node example:
```ts
const child = spawn('git', ['status']);
child.stdout.on('data', (chunk) => {
  // normal output from git
});
child.stderr.on('data', (chunk) => {
  // warnings or errors
});
child.stdin.write('yes\n');
child.stdin.end();
```

Repo examples:
- terminal keystrokes go to `stdin`
- `cursor-agent` JSON events arrive on `stdout`
- many CLI failures appear on `stderr`

### TTY and PTY
- `TTY`: a terminal device
- `PTY`: a pseudo-terminal, meaning software that behaves like a terminal

Why it matters:
- `spawn()` is best for non-interactive commands like `git status`
- `node-pty` is best for interactive shells like PowerShell or bash sessions

Repo example: `server/index.js` uses `node-pty` for the integrated shell because agents and shells expect terminal behavior, not just plain pipes.

### argv
`argv` means argument vector: the list of command-line arguments passed to a program.

Example:
```ts
spawn('git', ['log', '--oneline', '-5']);
```

Here the executable is `git` and the argv is `['log', '--oneline', '-5']`. This is safer than building one big shell string because Node passes arguments directly instead of asking a shell to reinterpret them.

### cwd
`cwd` means current working directory. Examples:
- run `git status` in the project root
- run `claude mcp add --scope local` inside the current project
- run a terminal session inside a selected workspace

If `cwd` is wrong, parsing may look broken even when the parser is correct, because the command itself is operating in the wrong place.

### Buffer, String, and Decoding
A `Buffer` is raw bytes. A string is decoded text. Processes emit bytes first, then you decode them, and only after that should you parse lines, JSON, or tokens.

Example:
```ts
child.stdout.on('data', (chunk: Buffer) => {
  const text = chunk.toString('utf8');
});
```

### Line Ending
A line ending marks the end of a text line:
- Linux/macOS usually use LF: `\n`
- Windows often uses CRLF: `\r\n`
- older tools sometimes emit CR alone: `\r`

Classic bug:
```ts
'a\r\nb\r\n'.split('\n');
// ['a\r', 'b\r', '']
```

That hidden trailing `\r` is one of the most common Windows parsing bugs.

### BOM
BOM means byte order mark. In UTF-8 text it appears as `\uFEFF` at the start. Typical failures:
- first key becomes `\uFEFFNAME` instead of `NAME`
- JSON parsing fails because the first character is not what the parser expected
- `.env` parsing silently produces the wrong first variable name

The adapter layer strips BOM explicitly for that reason.

### Chunk
A chunk is one partial piece of stream data. Chunks are transport boundaries, not logical message boundaries. Important rules:
- one line can arrive in multiple chunks
- one chunk can contain many lines
- one JSON object can be split across chunk boundaries

Example:
```txt
Chunk 1: {"type":"message","text":"hel
Chunk 2: lo"}\r\n{"type":"message","text":"next"}\r\n
```

If you parse each chunk independently, you corrupt the first JSON object.

## The Backend Parsing Lifecycle
Most backend parsing problems in this repo can be viewed as a four-step pipeline:
1. Receive raw bytes or raw text.
2. Normalize transport details.
3. Parse business structure.
4. Return normalized data to the rest of the app.

Examples:
- file bytes -> UTF-8 string -> normalize line endings -> split lines -> parse fields
- stdout chunks -> accumulate partial lines -> parse JSON per line -> emit events
- browser terminal input -> normalize Enter/newlines -> write to PTY

The operating system mainly affects step 2. That is why the new adapter layer exists.

## Linux vs Windows Differences That Usually Matter
### 1. Newlines In Files And Process Output
Linux usually gives LF. Windows often gives CRLF. Some tools mix them.

Bad pattern:
```ts
const lines = output.split('\n');
```

Safer pattern:
```ts
import { splitLines } from '@/shared/platform/index.js';

const lines = splitLines(output, {
  preserveEmptyLines: false,
  trimTrailingEmptyLine: true,
});
```

Use `splitLines()` when you already have the whole string in memory.

### 2. Chunked Streams
A process stream is not line-oriented by default.

Bad pattern:
```ts
child.stdout.on('data', (chunk) => {
  const event = JSON.parse(chunk.toString());
});
```

This fails when one JSON object is split across chunks.

Safer pattern:
```ts
import { createStreamLineAccumulator } from '@/shared/platform/index.js';

const lines = createStreamLineAccumulator({ preserveEmptyLines: false });
child.stdout.on('data', (chunk) => {
  for (const line of lines.push(chunk)) {
    const event = JSON.parse(line);
  }
});
child.on('close', () => {
  for (const line of lines.flush()) {
    const event = JSON.parse(line);
  }
});
```

Use this for Cursor, Gemini, JSONL, NDJSON, or any line-based CLI protocol.

### 3. Shell Syntax And Fallback Logic
POSIX shells and PowerShell do not use the same syntax.
- POSIX fallback: `cmd1 || cmd2`
- PowerShell fallback: `cmd1; if ($LASTEXITCODE -ne 0) { cmd2 }`

Use:
```ts
import { buildFallbackCommand, createShellSpawnPlan } from '@/shared/platform/index.js';

const shellCommand = buildFallbackCommand('codex resume 123', 'codex', 'windows');
const spawnPlan = createShellSpawnPlan(shellCommand, 'windows');
```

This keeps feature code from hardcoding bash rules into Windows paths or PowerShell rules into Linux code.

### 4. Quoting Rules
Even when two shells both support quotes, they do not escape them the same way.
- POSIX single quote escape is awkward: `'it'"'"'s'`
- PowerShell single quote escape doubles the quote: `'it''s'`

Use:
```ts
import { quoteShellArgument } from '@/shared/platform/index.js';

const safe = quoteShellArgument("it's", 'windows');
```

### 5. Path Separators And Case
- Linux paths use `/`
- Windows paths typically use `\`
- Linux is usually case-sensitive
- Windows is usually case-insensitive

Examples:
- `/repo/File.ts` and `/repo/file.ts` are different on Linux
- `C:\Repo\File.ts` and `c:\repo\file.ts` usually refer to the same file on Windows

Use:
```ts
import { arePathsEquivalent, normalizePathForPlatform, toPortablePath } from '@/shared/platform/index.js';
```

Guideline:
- use platform-specific paths when calling the OS
- use portable slash paths for logs, keys, and serialized payloads

### 6. Terminal Input
Terminal input is not the same as a normal HTML form submission.
- pressing Enter may arrive as `\r`
- pasted text may contain `\n` or `\r\n`
- terminal apps often expect carriage return behavior

Use:
```ts
import { normalizeTerminalInput } from '@/shared/platform/index.js';
```

This matters for PTY writes because terminal software often treats `\r` as the real Enter key behavior.

## The New Adapter Functions
- `normalizeTextForParsing()`: use when your goal is parsing text consistently, not preserving original file style; good for `.env`, JSONL, human-readable CLI output, and buffered command output.
- `splitLines()`: use when the full text is already in memory and you want clean logical lines; good for config files, buffered Git output, and fully collected CLI output.
- `createStreamLineAccumulator()`: use when text arrives incrementally over time; good for `stdout`, `stderr`, line-based streaming JSON, and long-lived child processes.
- `createShellSpawnPlan()`: use when the command must go through a shell because shell syntax is required; good for fallback commands, resume-or-start command chains, and interactive shell launch plans.
- `quoteShellArgument()`: use before interpolating dynamic values into shell command strings; good for session IDs, file paths, branch names, and user-provided subcommands.
- `buildFallbackCommand()`: use when the same logic must work in bash and PowerShell; a repo-shaped example is "resume Codex session if it exists, otherwise start a fresh one."
- `preserveExistingLineEndings()`: use when writing text files back to disk and you want to avoid noisy diffs; good for markdown files, config files, and user-managed text artifacts.

## Practical Backend Rules For This Repo
1. If you already have the full text, normalize once and then parse.
2. If the source is a stream, use an accumulator and never parse per chunk.
3. Prefer `spawn(executable, argv, { shell: false })` whenever possible.
4. Only use a shell when shell syntax is actually needed.
5. When you must use a shell, push all shell-specific behavior into the adapter layer.
6. Preserve existing line endings on user files unless you intentionally want normalization.
7. Separate transport normalization from business parsing.

## Common Mistakes To Avoid
- Parsing stdout chunk-by-chunk. Symptom: random JSON parse failures or truncated events. Fix: accumulate complete lines first.
- Using `split('\n')` on Windows text. Symptom: values end with `\r` and equality checks fail. Fix: normalize line endings or use `splitLines()`.
- Building one huge shell string for everything. Symptom: quoting bugs, OS-specific failures, and injection risk. Fix: prefer `spawn()` with argv; if shell is required, use `quoteShellArgument()` and `createShellSpawnPlan()`.
- Rewriting files with a different line-ending style. Symptom: huge git diffs and noisy file changes. Fix: use `preserveExistingLineEndings()`.

## Testing Strategy Implemented Here
This strategy intentionally does not add Jest, Vitest, or another test framework.

It uses:
- Node's built-in `node:test`
- `tsx` only to execute TypeScript tests
- a GitHub Actions matrix on Ubuntu and Windows

Local verification:
```bash
npm run test:server
npm run verify:server
```

CI verification:
- `npm run typecheck:server`
- `npm run test:server`
- `npm run server:build`

This gives you two kinds of confidence:
- contract confidence: the adapter functions behave as designed
- environment confidence: the same checks pass on real Linux and Windows runners

## Final Mental Model
Think in three layers:
1. Raw transport layer. Examples: chunks, bytes, terminal keystrokes, raw file text.
2. Normalization layer. Examples: strip BOM, normalize line endings, normalize terminal input, normalize shell behavior.
3. Business parsing layer. Examples: parse JSON, parse CLI output, parse `.env`, parse Git status, parse session files.

If you keep layer 2 in shared adapters, layer 3 stops caring about Linux vs Windows.
