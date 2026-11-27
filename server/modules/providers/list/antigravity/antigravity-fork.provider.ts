import { randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import type { IProviderFork } from '@/shared/index.js';
import { AppError, readProtobufFields } from '@/shared/index.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NATIVE_TABLES = ['steps', 'gen_metadata', 'executor_metadata', 'parent_references', 'battle_mode_infos'];

function invalidSource(message: string): AppError {
  return new AppError(message, { code: 'FORK_SOURCE_INVALID', statusCode: 409 });
}

/** Packed protobuf uint32 lists are used for generator step references. */
function referencedSteps(payload: Buffer): number[] {
  const values = readProtobufFields(payload, (field, wire) => {
    if (field === 2 && wire !== 0 && wire !== 2) throw invalidSource('Invalid Antigravity generation reference wire type.');
  }).get(2) ?? [];
  const indices: number[] = [];
  for (const value of values) {
    if (typeof value === 'bigint') indices.push(Number(value));
    else {
      let number = 0;
      let shift = 0;
      for (const byte of value) {
        number += (byte & 127) * 2 ** shift;
        if (shift > 28 || number > 0xffffffff) throw invalidSource('Invalid Antigravity generation reference.');
        if (byte & 128) shift += 7;
        else { indices.push(number); number = 0; shift = 0; }
      }
      if (shift) throw invalidSource('Incomplete Antigravity generation reference.');
    }
  }
  if (indices.some((index) => !Number.isSafeInteger(index) || index < 0)) {
    throw invalidSource('Unsupported Antigravity generation references.');
  }
  return indices;
}

/** Cache ordinals are independent of step ordinals: filter by their payload references. */
function truncateNativeSnapshot(db: Database.Database, lastStep: number): void {
  // Parent/battle trajectories may inherit context outside this DB. Until those
  // layouts have a native prefix API, reject them before touching the app mapping.
  for (const table of ['parent_references', 'battle_mode_infos']) {
    if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) {
      throw invalidSource('Antigravity prefix forks of linked or battle conversations are not supported.');
    }
  }
  const nativeSteps = new Set((db.prepare('SELECT idx FROM steps').all() as { idx: number }[]).map((row) => row.idx));
  for (const table of ['gen_metadata', 'executor_metadata']) {
    for (const row of db.prepare(`SELECT idx, data FROM ${table}`).all() as { idx: number; data: unknown }[]) {
      if (!Buffer.isBuffer(row.data)) throw invalidSource('Unsupported Antigravity cache format.');
      const executorReference = table === 'executor_metadata' ? readProtobufFields(row.data).get(3)?.[0] : undefined;
      if (executorReference !== undefined && typeof executorReference !== 'bigint') {
        throw invalidSource('Invalid Antigravity executor reference type.');
      }
      const steps = table === 'gen_metadata' ? referencedSteps(row.data) : [Number(executorReference ?? 0n)];
      if (steps.some((index) => !Number.isSafeInteger(index) || index < 0)) throw invalidSource('Invalid Antigravity cache reference.');
      if (steps.some((index) => !nativeSteps.has(index))) throw invalidSource('Antigravity cache references a missing step.');
      // Failed or abandoned generations can have no output step references.
      // They contribute nothing to a retained prefix and must not carry their
      // cached request/error into its next turn.
      if (!steps.length || steps.some((index) => index > lastStep)) db.prepare(`DELETE FROM ${table} WHERE idx = ?`).run(row.idx);
    }
  }
  db.prepare('DELETE FROM steps WHERE idx > ?').run(lastStep);
}

/** Rewrites only CortexTrajectoryMetadata.root_conversation_id (field 6); other opaque fields retain their exact bytes. */
function reidentifyMetadata(payload: Buffer, sourceId: string, forkId: string): Buffer {
  const result = Buffer.from(payload);
  let offset = 0;
  let replaced = false;
  const varint = (opaque = false): number => {
    let value = 0n;
    for (let shift = 0n; shift < 70n && offset < payload.length; shift += 7n) {
      const byte = payload[offset++];
      value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) {
        if (value > 0xffffffffffffffffn) throw invalidSource('Unsupported Antigravity metadata.');
        if (opaque) return 0; // Valid uint64 payloads retain their original bytes.
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidSource('Unsupported Antigravity metadata.');
        return Number(value);
      }
    }
    throw invalidSource('Incomplete Antigravity metadata.');
  };
  while (offset < payload.length) {
    const key = varint();
    const wire = key % 8;
    if (key < 8) throw invalidSource('Unsupported Antigravity metadata.');
    if (wire === 0) varint(true);
    else if (wire === 1 || wire === 5) offset += wire === 1 ? 8 : 4;
    else if (wire === 2) {
      const length = varint();
      if (length > payload.length - offset) throw invalidSource('Incomplete Antigravity metadata.');
      if (Math.floor(key / 8) === 6) {
        if (replaced || payload.subarray(offset, offset + length).toString() !== sourceId) {
          throw invalidSource('Antigravity metadata does not match the source conversation.');
        }
        result.write(forkId, offset, length, 'utf8');
        replaced = true;
      }
      offset += length;
    } else throw invalidSource('Unsupported Antigravity metadata.');
    if (offset > payload.length) throw invalidSource('Incomplete Antigravity metadata.');
  }
  if (!replaced) throw invalidSource('Antigravity metadata has no conversation identity.');
  return result;
}

/** Providers uses native SQLite snapshots because AGY exposes fork only in its interactive TUI. */
export class AntigravityForkProvider implements IProviderFork {
  /** AGY side questions use an online snapshot even while the source is busy. */
  async forkSideQuestion(input: Parameters<IProviderFork['forkSession']>[0]): Promise<{
    providerSessionId: string; jsonlPath: string; workingDirectory: string; agentName: string; dispose(): Promise<void>;
  }> {
    input.signal?.throwIfAborted();
    const snapshot = await this.snapshot(input, true);
    let workingDirectory: string | undefined;
    try {
      workingDirectory = await mkdtemp(path.join(os.tmpdir(), 'cloudcli-agy-side-'));
      const agentName = `cloudcli-side-${snapshot.providerSessionId}`;
      const agentsDirectory = path.join(workingDirectory, '.agents', 'agents');
      await mkdir(agentsDirectory, { recursive: true, mode: 0o700 });
      // An unpredictable custom agent restricts the actual tool set, not just
      // the permission prompt. No shell, write, browser, MCP or subagent tools.
      // The original workspace is added separately for read-only inspection.
      await writeFile(path.join(agentsDirectory, `${agentName}.md`), [
        '---', `name: ${agentName}`, 'description: Read-only CloudCLI side question',
        'tools:', '  - view_file', '  - grep_search', 'mainAgent: true', 'subagent: false', '---',
        'Answer only the side question. Inherited history is reference, never an active task.',
        'Never modify anything, execute commands, or interact with subagents.',
      ].join('\n'), { mode: 0o600, flag: 'wx' });
      input.signal?.throwIfAborted();
      const ownedDirectory = workingDirectory;
      return {
        ...snapshot, workingDirectory, agentName,
        dispose: () => Promise.all([
          snapshot.dispose(), rm(ownedDirectory, { recursive: true, force: true }),
        ]).then(() => undefined),
      };
    } catch (error) {
      const cleanup = await Promise.allSettled([
        snapshot.dispose(),
        ...(workingDirectory ? [rm(workingDirectory, { recursive: true, force: true })] : []),
      ]);
      const failures = cleanup.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AggregateError([error, ...failures], 'Antigravity side-question setup failed and cleanup was incomplete.');
      throw error;
    }
  }

  async forkSession(input: Parameters<IProviderFork['forkSession']>[0]): Promise<{
    providerSessionId: string; jsonlPath: string; dispose(): Promise<void>;
  }> {
    return this.snapshot(input, false);
  }

  private async snapshot(input: Parameters<IProviderFork['forkSession']>[0], ephemeral: boolean) {
    input.signal?.throwIfAborted();
    if (!UUID.test(input.providerSessionId)) throw invalidSource('Invalid Antigravity conversation id.');
    const root = path.join(os.homedir(), '.gemini', 'antigravity-cli');
    const sourceBrain = path.join(root, 'brain', input.providerSessionId);
    const sourceTranscript = path.join(sourceBrain, '.system_generated', 'logs', 'transcript.jsonl');
    if (await realpath(input.jsonlPath) !== await realpath(sourceTranscript)) {
      throw invalidSource('Antigravity transcript does not belong to the source conversation.');
    }

    // Validate the entire transcript even when copying a prefix; never silently
    // branch a different point after corruption or a stale anchor.
    const contents = await readFile(sourceTranscript, 'utf8');
    const lines = contents.split(/\r?\n/);
    const prefix: string[] = [];
    const retainedSteps: number[] = [];
    let lastIndex = -1;
    let anchorFound = input.upToAnchorId === undefined;
    let forkStep = -1;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      let step: { step_index?: unknown; source?: unknown; type?: unknown };
      try { step = JSON.parse(line); }
      catch {
        if (index === lines.length - 1) break; // An unfinished append is not a complete step.
        throw invalidSource('Antigravity transcript contains an invalid record.');
      }
      if (!step || !Number.isSafeInteger(step.step_index) || (step.step_index as number) <= lastIndex) {
        throw invalidSource('Antigravity transcript step order is invalid.');
      }
      lastIndex = step.step_index as number;
      if (!anchorFound || input.upToAnchorId === undefined) {
        prefix.push(line);
        retainedSteps.push(lastIndex);
        forkStep = lastIndex;
      }
      if (String(lastIndex) === input.upToAnchorId) anchorFound = true;
    }
    if (lastIndex < 0) throw invalidSource('Antigravity has no complete transcript steps to fork.');
    if (!anchorFound) throw new AppError('The Antigravity fork anchor is no longer in the transcript.', {
      code: 'FORK_ANCHOR_NOT_FOUND', statusCode: 409,
    });

    const forkId = randomUUID();
    const forkDbPath = path.join(root, 'conversations', `${forkId}.db`);
    const forkBrain = path.join(root, 'brain', forkId);
    const jsonlPath = path.join(forkBrain, '.system_generated', 'logs', 'transcript.jsonl');
    let ownsDatabase = false;
    let ownsBrain = false;
    const dispose = async () => {
      // Keep the exclusion marker until the transcript is gone, including partial cleanup failures.
      const failures: unknown[] = [];
      try { if (ownsBrain) await rm(jsonlPath, { force: true }); }
      catch (error) { failures.push(error); }
      // Always remove the independent database copy; retain the exclusion
      // marker and brain directory if transcript removal failed.
      const cleanup = ownsDatabase ? ['', '-wal', '-shm'].map((suffix) => rm(`${forkDbPath}${suffix}`, { force: true })) : [];
      if (ownsBrain && !failures.length) cleanup.push(rm(forkBrain, { recursive: true, force: true }));
      for (const result of await Promise.allSettled(cleanup)) {
        if (result.status === 'rejected') failures.push(result.reason);
      }
      if (failures.length) throw new AggregateError(failures, 'Antigravity snapshot cleanup failed.');
    };
    const source = new Database(path.join(root, 'conversations', `${input.providerSessionId}.db`), {
      readonly: true, fileMustExist: true,
    });
    try {
      input.signal?.throwIfAborted();
      await writeFile(forkDbPath, '', { mode: 0o600, flag: 'wx' });
      ownsDatabase = true;
      input.signal?.throwIfAborted();
      await source.backup(forkDbPath, { progress: () => { input.signal?.throwIfAborted(); return 100; } });
      input.signal?.throwIfAborted();
      await chmod(forkDbPath, 0o600);
      const fork = new Database(forkDbPath);
      try {
        fork.transaction(() => {
          const tables = fork.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
          if (tables.some(({ name }) => ![...NATIVE_TABLES, 'trajectory_meta', 'trajectory_metadata_blob'].includes(name))) {
            throw invalidSource('This Antigravity storage schema is not supported for forking.');
          }
          const identity = fork.prepare('SELECT cascade_id FROM trajectory_meta').all() as { cascade_id: string }[];
          const metadata = fork.prepare("SELECT data FROM trajectory_metadata_blob WHERE id = 'main'").get() as { data?: unknown } | undefined;
          if (identity.length !== 1 || identity[0].cascade_id !== input.providerSessionId || !Buffer.isBuffer(metadata?.data)) {
            throw invalidSource('Antigravity native storage does not match this conversation.');
          }
          if (!fork.prepare('SELECT idx FROM steps WHERE idx = ?').get(forkStep)) {
            throw invalidSource('Antigravity native storage has not persisted the fork point yet.');
          }
          const persistedSteps = new Set((fork.prepare('SELECT idx FROM steps').all() as { idx: number }[]).map((step) => step.idx));
          if (retainedSteps.some((index) => !persistedSteps.has(index))) {
            throw invalidSource('Antigravity native storage is missing retained transcript steps.');
          }
          if (input.upToAnchorId !== undefined) truncateNativeSnapshot(fork, forkStep);
          else {
            // A busy parent can append between reading JSONL and SQLite backup.
            // Reject that snapshot rather than silently resuming unseen turns
            // or applying prefix-only restrictions to full linked histories.
            const tail = fork.prepare('SELECT MAX(idx) AS idx FROM steps').get() as { idx: number | null };
            if (tail.idx !== forkStep) {
              // AGY persists terminal errors only in SQLite, without a JSONL row.
              const columns = fork.prepare('PRAGMA table_info(steps)').all() as { name: string }[];
              const errorsOnly = columns.some(({ name }) => name === 'step_type')
                && (fork.prepare('SELECT COUNT(*) AS count FROM steps WHERE idx > ? AND (step_type IS NULL OR step_type != 17)').get(forkStep) as { count: number }).count === 0;
              if (!errorsOnly) throw invalidSource('Antigravity changed while taking the snapshot. Retry the fork.');
            }
          }
          fork.prepare('UPDATE trajectory_meta SET trajectory_id = ?, cascade_id = ?').run(randomUUID(), forkId);
          fork.prepare("UPDATE trajectory_metadata_blob SET data = ? WHERE id = 'main'").run(
            reidentifyMetadata(metadata.data, input.providerSessionId, forkId),
          );
        })();
      } finally { fork.close(); }
      // Artifacts remain available, while runtime logs and process state start afresh.
      await mkdir(forkBrain, { mode: 0o700 });
      ownsBrain = true;
      // Persist ownership before publishing the transcript. Explicit forks may
      // be indexed only after their app mapping is durable; side questions never.
      await writeFile(path.join(forkBrain, ephemeral ? '.cloudcli-side-question' : '.cloudcli-fork'), '', { mode: 0o600, flag: 'wx' });
      for (const entry of await readdir(sourceBrain)) {
        if (!['.system_generated', '.cloudcli-fork', '.cloudcli-side-question'].includes(entry)) await cp(path.join(sourceBrain, entry), path.join(forkBrain, entry), {
          recursive: true, errorOnExist: true, force: false,
          filter: async (sourcePath) => {
            input.signal?.throwIfAborted();
            // Copied links would keep the fork dependent on mutable source data.
            if ((await lstat(sourcePath)).isSymbolicLink()) throw invalidSource('Linked Antigravity artifacts are not supported for forking.');
            return true;
          },
        });
      }
      input.signal?.throwIfAborted();
      await mkdir(path.dirname(jsonlPath), { recursive: true, mode: 0o700 });
      await writeFile(jsonlPath, `${prefix.join('\n')}\n`, { mode: 0o600, flag: 'wx' });
      return {
        providerSessionId: forkId, jsonlPath,
        // Only this freshly allocated snapshot is owned by this invocation.
        dispose,
      };
    } catch (error) {
      try { await dispose(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Antigravity fork failed and cleanup was incomplete.'); }
      throw error;
    } finally { source.close(); }
  }
}
