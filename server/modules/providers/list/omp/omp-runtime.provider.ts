// omp runtime adapter — drives `omp acp` (Agent Client Protocol, JSON-RPC 2.0
// over stdio) for live chat turns. Built against omp v17.0.6; behaviour re-verified
// against v17.2.2 (see the session/load note below — it changed between them).
//
// Structure follows the Hermes ACP adapter (persistent per-cwd connection,
// complete-on-prompt-resolve, session/cancel abort coordinated with
// handleChatAbort) but talks through the P2 StdioJsonRpcClient (from Kiro #760)
// instead of a bespoke ACP client.
//
// Multiplexing: one `omp acp` child per (cwd, approval profile) hosts MANY ACP
// sessions (two chats in the same folder and mode share it). SINGLE
// connection-level handlers route each
// `session/update` notification AND each inbound `session/request_permission`
// request to the owning run by session id, so runs never clobber one another.
// Native session ids come ONLY from session/new and session/load results.
//
// Approvals: the config overlay depends on the run's permission mode (see
// APPROVAL_PROFILES). EVERY profile uses `always-ask`, so omp asks over ACP and the
// run gates client-side through the shared tool-approval registry (same path as
// Claude) — bypassPermissions is auto-allowed there rather than handed omp's
// `yolo`, which would drop omp's own destructive-command backstop.
//
// session/load: on v17.0.6 it was in-memory per child and threw for any session
// this child had not created, which is why the session/fork fallback exists. On
// v17.2.2 it resumes from disk WITH history, across processes — measured. So a
// resume normally stays in-place on the same id, and fork is now the rare path.
// It reads disk ONLY for a session the child does not already hold, though: a
// re-load of a session already in memory replays the child's own frozen copy.
// connectionInSyncWith is what keeps a warm child from answering from a snapshot
// the user's terminal has since moved past.
import { spawn } from 'node:child_process';
import type { ChildProcess, ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdtempSync, writeFileSync, existsSync, realpathSync, constants as fsConstants, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import crossSpawn from 'cross-spawn';

import { sessionsDb } from '@/modules/database/index.js';
import { OMP_CONFIGURED_MODEL_SENTINEL, OMP_FALLBACK_CONTEXT_WINDOW, readOmpContextWindow } from '@/modules/providers/list/omp/omp-models.provider.js';
import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';
import { buildAcpPromptBlocks } from '@/shared/image-attachments.js';
import { locateOmpSessionFile } from '@/modules/providers/list/omp/omp-session-files.js';
import { StdioJsonRpcClient } from '@/modules/providers/list/omp/stdio-jsonrpc-client.js';
import {
  getPendingApprovalsForSession,
  registerApproval,
  resolveToolApproval,
  unregisterApproval,
} from '@/shared/tool-approval-registry.js';
import type {
  AnyRecord,
  NormalizedMessage,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
} from '@/shared/types.js';

/**
 * One `omp acp` child plus its JSON-RPC client, shared by every run in a cwd.
 *
 * Exported as a test seam: the provider tests substitute a fake connection
 * factory through `__setConnectionFactoryForTest`, which needs this shape.
 */
export type OmpConnection = {
  child: ChildProcess;
  client: StdioJsonRpcClient;
  initializeResult: AnyRecord | null;
  ready?: Promise<OmpConnection>;
  /**
   * Session id → the jsonl fingerprint this child was last in sync with. A child
   * that already holds a session in memory IGNORES a later `session/load` (see
   * staleness note below), so this is how we notice it has gone stale.
   * Created on demand — a test's fake connection factory need not supply it.
   */
  loadedSessions?: Map<string, string | null>;
};

/** Run options the chat/REST dispatchers hand to the runtime. */
type OmpRunOptions = {
  sessionId?: string | null;
  projectPath?: string;
  cwd?: string;
  sessionSummary?: string;
  permissionMode?: string;
  model?: string | null;
  effort?: string;
  images?: unknown;
};

/** One in-flight run, keyed in activeOmpSessions by omp's native session id. */
type OmpSessionEntry = {
  connection: OmpConnection;
  /**
   * omp's own session id. Keys `activeOmpSessions` because every inbound ACP
   * frame (`session/update`, `session/request_permission`) identifies its
   * session by this id, and it is what `session/cancel` accepts.
   */
  sessionId: string;
  /**
   * The stable app-facing id the client knows, or null for direct API callers
   * that address omp natively. Client-bound frames and the approval registry
   * use it, because the chat gateway looks approvals up by app id and clients
   * abort with it.
   */
  appSessionId: string | null;
  writer: ProviderRuntimeWriter;
  sessionSummary?: string;
  permissionMode: string;
  aborted: boolean;
  acceptingUpdates: boolean;
  normalizeMessage: (raw: AnyRecord, sid: string | null) => NormalizedMessage[];
};

type OmpSetupReservation = {
  aborted: boolean;
};

/** ACP `session/request_permission` response. */
type AcpPermissionOutcome = { outcome: { outcome: string; optionId?: string } };

const spawnFunction = process.platform === 'win32' ? crossSpawn : spawn;
const PROVIDER = 'omp';

// ACP `session/prompt` resolves only at end-of-turn (routinely minutes), so it
// opts out of the client's 2-minute default with a large bounded ceiling.
// The 30-minute cap frees a wedged turn eventually; raise it if real turns exceed it.
const PROMPT_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

// omp only emits session/request_permission over ACP when BOTH (a) tools.approvalMode
// is not 'yolo' and (b) the client advertises fs capabilities (verified against omp
// v17.0.6: writeTextFile:false or yolo → omp silently auto-runs tools and never
// asks). initialize always advertises fs; whether omp asks at all is then decided
// by the per-mode overlay below.
/**
 * omp gates some tools twice: once over ACP (our UI prompt) and once internally,
 * where only a TTY can answer — headless, that inner gate fails as "Tool call
 * denied by user: <tool>". `tools.approval.<tool>: allow` satisfies the inner gate
 * without suppressing the ACP request, so approve/deny still flows through our UI.
 *
 * The right policy depends on the run's permission mode, so each mode gets its own
 * overlay (and its own omp child — see connection keying below).
 *
 * Both profiles use `always-ask`, deliberately. omp's own `yolo` would skip its
 * gate entirely, which is tempting for bypassPermissions — but it also DROPS omp's
 * destructive-command backstop: under always-ask, "override" tools (rm -rf /, sudo
 * rm, mkfs, dd of=/dev/, curl|bash, fork bombs) ignore a per-tool `allow` and stay
 * denied headlessly, whereas yolo auto-approves even those. That matters because
 * bypassPermissions is not always a deliberate choice: readOmpDefaultPermissionMode
 * derives it from a user's `approvalMode: yolo` config, so it can be the DEFAULT
 * composer mode for someone who never touched the mode picker. Keeping always-ask
 * costs nothing — routePermissionRequest auto-allows a bypass run without a prompt.
 *
 * - `gated` (default AND bypassPermissions): our client gates what omp asks about,
 *   and the tools omp never asks about are pre-allowed so they can run at all. Those
 *   run UNPROMPTED — the choice is "unprompted" or "always denied", not "prompted".
 *   The renderer shows eval's code so unprompted is at least not invisible.
 * - `plan`: the ACP-gated tools only. Withholding the unprompted mutators is what
 *   keeps plan read-only, alongside routePermissionRequest's plan arm and the
 *   fs/write guard.
 *
 * This pins omp's known sensitive set; add tools here if omp starts gating more.
 */
// omp gates a tool by capability tier (read/write/exec) but the config allowlist is
// per TOOL NAME, and omp only routes bash/edit/delete/move through the ACP gate our
// UI answers. Every other gated tool hits omp's internal, TTY-only prompt instead —
// which headless fails as "Tool call denied by user: <tool>", blaming a user who was
// never asked. So each one needs an explicit `allow` here or it simply cannot run.
// Enumerated from `omp -p "List every tool you can call"` on v17.2.2 rather than
// guessed: eval and write were each discovered the hard way, one bug report apiece.
//
// ACP-gated: omp asks, our client decides (auto-allow on bypass, prompt on default,
// deny on plan). Safe in every profile — `allow` only satisfies the inner gate.
const ACP_GATED_TOOLS = ['bash', 'edit', 'delete', 'move'];
// NOT ACP-gated: omp never asks the client about these, so `allow` means they run
// UNPROMPTED while its absence means they fail silently. They are therefore withheld
// from the plan profile, which is what keeps plan read-only.
const UNPROMPTED_MUTATORS = ['write', 'eval', 'ast_edit', 'memory_edit', 'manage_skill', 'browser', 'task'];

const toolAllowList = (tools: readonly string[]) =>
  '  approval:\n' + tools.map((tool: string) => '    ' + tool + ': allow\n').join('');
// Exported as a test seam: the provider tests assert the overlay each permission
// mode produces, which is what keeps plan mode read-only.
export const APPROVAL_PROFILES = {
  plan: `tools:\n  approvalMode: always-ask\n${toolAllowList(ACP_GATED_TOOLS)}`,
  gated: `tools:\n  approvalMode: always-ask\n${toolAllowList([...ACP_GATED_TOOLS, ...UNPROMPTED_MUTATORS])}`,
};

type ApprovalProfile = keyof typeof APPROVAL_PROFILES;

/**
 * Which overlay a run needs, from its permission mode.
 *
 * Exported as a test seam so the mode-to-profile mapping is asserted directly.
 */
export function approvalProfileFor(permissionMode: string): ApprovalProfile {
  return permissionMode === 'plan' ? 'plan' : 'gated';
}

const approvalOverlayPaths = new Map<ApprovalProfile, string>();
let approvalOverlayDir: string | null = null;
function getApprovalOverlayPath(profile: ApprovalProfile) {
  const cached = approvalOverlayPaths.get(profile);
  // Re-create if never made OR the tmp file was reaped (systemd-tmpfiles clears
  // /tmp ~10d), else a long-lived server spawns `omp acp --config <missing>`.
  if (!cached || !existsSync(cached)) {
    // One dir, one file per profile — the profiles differ only in content.
    if (!approvalOverlayDir || !existsSync(approvalOverlayDir)) {
      approvalOverlayDir = mkdtempSync(path.join(os.tmpdir(), 'omp-acp-'));
    }
    const overlayPath = path.join(approvalOverlayDir, `${profile}.yml`);
    // See APPROVAL_PROFILES for what each overlay buys and what it costs.
    // NOTE (always-ask profiles only): omp's bash approval is INPUT-dependent —
    // destructive commands (rm -rf /, sudo rm, mkfs, dd of=/dev/, curl|bash,
    // shutdown, fork-bombs, …) are "override" tools where omp IGNORES per-tool
    // `allow` (only `deny` is honored), so the inner gate still fires headlessly
    // and such a command is denied even after the user clicks Allow. This FAILS
    // CLOSED (desirable) — don't debug it as a regression. This backstop is
    // precisely why no profile uses omp's `yolo`, which auto-approves them.
    // INFO: --config deep-merges OVER user config, so a user's own
    // `tools.approval.bash: deny` becomes allow for the session; acceptable
    // because our ACP prompt still gates interactively.
    writeFileSync(overlayPath, APPROVAL_PROFILES[profile]);
    approvalOverlayPaths.set(profile, overlayPath);
    return overlayPath;
  }
  return cached;
}

// Max bytes for a single delegated fs read/write.
// 10MB covers source files; raise it if real edits exceed it.
const FS_MAX_BYTES = 10 * 1024 * 1024;

// The given base plus its realpath (like the image guard's getDirectoryPathVariants):
// omp may send kernel-canonical paths (macOS /tmp → /private/tmp), so a legit
// in-cwd target must be accepted under EITHER form.
function baseDirVariants(baseDir: string) {
  const resolved = path.resolve(baseDir);
  try {
    const canonical = path.resolve(realpathSync(baseDir));
    return canonical === resolved ? [resolved] : [resolved, canonical];
  } catch {
    return [resolved];
  }
}

// Cheap string-level containment pre-check (no per-target symlink resolution —
// that's safeRead/WriteTarget's job). Tolerant of canonical-vs-given base.
function resolveWithinDir(baseDir: string, target: string) {
  if (typeof target !== 'string' || !target) {
    return null;
  }
  const resolved = path.resolve(baseDir, target);
  return baseDirVariants(baseDir).some((b) => resolved === b || resolved.startsWith(b + path.sep))
    ? resolved
    : null;
}

function withinBase(realBase: string, candidate: string) {
  return candidate === realBase || candidate.startsWith(realBase + path.sep);
}

// Resolves a delegated READ target to a realpath guaranteed inside baseDir,
// following symlinks and failing closed (mirrors the image guard's realpath
// re-check, image-attachments.ts:isAllowedImageSourcePath). Blocks a symlink
// inside cwd from exfiltrating e.g. ~/.ssh/id_rsa.
async function safeReadTarget(baseDir: string, target: string) {
  const resolved = resolveWithinDir(baseDir, target);
  if (!resolved) {
    throw new Error('path escapes working directory refused');
  }
  const realBase = await fsp.realpath(baseDir);
  const real = await fsp.realpath(resolved); // throws if missing → fail closed
  if (!withinBase(realBase, real)) {
    throw new Error('symlinked path escapes working directory refused');
  }
  return real;
}

// Resolves a delegated WRITE target (which may not exist yet): the PARENT dir's
// realpath must stay inside baseDir (blocks a parent-dir symlink like
// <cwd>/sub → /etc), and the final component must not be an existing symlink
// (blocks <cwd>/link → ~/.bashrc clobber).
async function safeWriteTarget(baseDir: string, target: string) {
  const resolved = resolveWithinDir(baseDir, target);
  if (!resolved) {
    throw new Error('path escapes working directory refused');
  }
  const realBase = await fsp.realpath(baseDir);
  const realParent = await fsp.realpath(path.dirname(resolved));
  if (!withinBase(realBase, realParent)) {
    throw new Error('symlinked path escapes working directory refused');
  }
  try {
    const st = await fsp.lstat(resolved);
    if (st.isSymbolicLink()) {
      throw new Error('refusing to write through a symlink');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error; // ENOENT = new file (fine); anything else fails closed
    }
  }
  return path.join(realParent, path.basename(resolved));
}

/**
 * Writes `content` to an already-guarded path without ever following a symlink.
 *
 * safeWriteTarget's lstat is a check-then-use, so a symlink planted between the
 * check and the write would otherwise be followed straight out of the working
 * directory. `noFollow` is injectable so the flagless path (Windows, where
 * O_NOFOLLOW does not exist) is testable on POSIX — which is also why the
 * provider tests import this directly rather than only through a run.
 */
export async function writeFileNoFollow(
  targetPath: string,
  content: string,
  noFollow: number = fsConstants.O_NOFOLLOW ?? 0,
): Promise<void> {
  // Truncating at open would zero a planted symlink's victim before anything
  // could be checked, so without the flag truncation waits for the check below.
  const truncateAtOpen = noFollow ? fsConstants.O_TRUNC : 0;
  let handle;
  try {
    handle = await fsp.open(targetPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | truncateAtOpen | noFollow);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ELOOP') {
      throw new Error('refusing to write through a symlink');
    }
    throw error;
  }
  try {
    if (!noFollow) {
      // open() may already have resolved a symlink, and the path can change again
      // afterwards — so checking the path alone proves nothing about what this
      // descriptor points at. The opened file must BE the file the path names
      // right now; a symlink's lstat reports the link's own inode, so it can never
      // match its target. Unresolvable identity (ino 0) fails closed.
      const [viaHandle, viaPath] = await Promise.all([handle.stat(), fsp.lstat(targetPath)]);
      const sameFile = viaPath.ino !== 0
        && viaHandle.ino === viaPath.ino
        && viaHandle.dev === viaPath.dev;
      if (viaPath.isSymbolicLink() || !sameFile) {
        throw new Error('refusing to write through a symlink');
      }
      await handle.truncate(0);
    }
    await handle.writeFile(content);
  } finally {
    await handle.close();
  }
}

// Active runs keyed by native session id. Resume reservations close the setup
// window before a run has a connection-backed entry in activeOmpSessions.
// Abortedness lives only on the per-run entry (`entry.aborted`); spawnOmp holds
// the entry by reference until its finally unwinds.
const activeOmpSessions = new Map<string, OmpSessionEntry>();
const reservedOmpSessionIds = new Set<string>();
// New app sessions do not have a native id to key activeOmpSessions by until
// session/new resolves. Reserve the app id so abort and duplicate sends still
// see the run during that setup window.
const pendingOmpSetups = new Map<string, OmpSetupReservation>();

function createRequestId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

function readSessionId(result: AnyRecord | null | undefined) {
  if (!result || typeof result !== 'object') {
    return null;
  }
  return result.sessionId || result.session_id || result.id || null;
}

function readStopReason(result: AnyRecord | null | undefined) {
  if (!result || typeof result !== 'object') {
    return null;
  }
  return result.stopReason || result.stop_reason || result.reason || null;
}

function canLoadSession(connection: OmpConnection) {
  return connection?.initializeResult?.agentCapabilities?.loadSession === true;
}

/**
 * Cheap identity of a session's on-disk jsonl (`size:mtime`), or null when the
 * file cannot be found. Compared across turns to detect that ANOTHER omp process
 * — the user's own terminal — appended to a session this child already holds.
 * Safe as a baseline: omp has fully flushed the jsonl by the time session/prompt
 * resolves (measured: byte-identical from t+0 to t+2s after the turn).
 */
async function sessionFileFingerprint(sessionId: string) {
  // Filename scan only, deliberately: the sessions DB would be a faster lookup, but
  // this runs twice per turn and a synchronous SQLite read can block on a lock held
  // by another process. The scan is a handful of readdirs and never blocks.
  try {
    const filePath = await locateOmpSessionFile(sessionId);
    if (!filePath) return null;
    const stat = await fsp.stat(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return null;
  }
}

// Reads the LAST assistant message's raw usage from a session jsonl
// (`{input,output,cacheRead,cacheWrite,totalTokens}`) together with the model
// that turn ran on — `provider`/`model` decide the context window, and only the
// transcript knows them (the session's configured model is often the "use omp
// default" sentinel). Prefers the synchronizer's stored path (DB), then a
// filename lookup (live turns before sync). Shared by the live token_budget
// status and the REST token-usage endpoint. Best-effort.
// Reads the whole jsonl each call — fine at chat scale; tail the stream instead if
// transcripts grow huge.
// Consumed by the providers module's token-usage service, which serves both the
// live `token_budget` status and the REST token-usage endpoint.
export async function readOmpSessionUsage(sessionId: string, knownPath: string | null = null) {
  try {
    const filePath = knownPath
      ?? sessionsDb.getSessionByProviderSessionId(sessionId)?.jsonl_path
      ?? await locateOmpSessionFile(sessionId);
    if (!filePath) return null;

    let usage = null;
    let model = null;
    let provider = null;
    for (const line of (await fsp.readFile(filePath, 'utf8')).split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let e;
      try { e = JSON.parse(t); } catch { continue; }
      if (e?.type === 'message' && e.message?.role === 'assistant' && e.message?.usage) {
        usage = e.message.usage; // keep the latest
        model = typeof e.message.model === 'string' ? e.message.model : null;
        provider = typeof e.message.provider === 'string' ? e.message.provider : null;
      }
    }
    return usage ? { usage, model, provider } : null;
  } catch {
    return null;
  }
}

// Maps the last assistant usage to the tokenBudget shape (frontend
// TokenUsageSummary reads `inputTokens`/`used`). null when no usage found.
async function readOmpTokenUsage(sessionId: string) {
  const record = await readOmpSessionUsage(sessionId);
  if (!record) return null;
  const { usage } = record;
  return {
    // inputTokens folds cacheRead in, matching the REST token-usage branch (index.js).
    inputTokens: Number(usage.input || 0) + Number(usage.cacheRead || 0),
    outputTokens: Number(usage.output || 0),
    used: Number(usage.totalTokens || 0),
    total: await readOmpContextWindow(record.provider, record.model) ?? OMP_FALLBACK_CONTEXT_WINDOW,
    // The model this turn actually ran on. A session's configured model is
    // usually the "use omp default" sentinel, so this is the only honest
    // answer the UI can show — and it is already resolved for the window.
    model: record.model ?? undefined,
    provider: record.provider ?? undefined,
    cacheRead: Number(usage.cacheRead || 0),
    cacheWrite: Number(usage.cacheWrite || 0),
  };
}

/**
 * Routes ONE `session/update` notification to its owning run's writer, keyed by
 * the native session id in the params. Updates for a run that is still replaying
 * history (resume) or has already finished are dropped.
 */
function routeSessionUpdate(sessions: Map<string, OmpSessionEntry>, params: AnyRecord) {
  const sid = readSessionId(params);
  if (!sid) {
    return;
  }
  const entry = sessions.get(sid);
  if (!entry || !entry.acceptingUpdates) {
    return;
  }
  // Normalization rides on the run's entry: the runtime context is per-run, and
  // importing sessionsService here would cycle back through the provider registry.
  const normalized = entry.normalizeMessage(params, sid);
  for (const msg of normalized) {
    entry.writer.send(msg);
  }
}

// --- ACP permission decision mapping (copied from Hermes hermes-cli.js) ------
function findPermissionOption(options: unknown, kinds: string[], fallbackOptionIds: string[] = []) {
  if (!Array.isArray(options)) {
    return null;
  }
  for (const kind of kinds) {
    const match = options.find((option) => option?.kind === kind);
    if (match?.optionId) {
      return match.optionId;
    }
  }
  for (const optionId of fallbackOptionIds) {
    const match = options.find((option) => option?.optionId === optionId);
    if (match?.optionId) {
      return match.optionId;
    }
  }
  return null;
}

function createPermissionDecision(
  decision: AnyRecord | null | undefined,
  options: unknown = [],
): AcpPermissionOutcome {
  if (!decision || decision.cancelled) {
    return { outcome: { outcome: 'cancelled' } };
  }
  if (decision.allow) {
    const optionId = decision.rememberEntry
      ? findPermissionOption(options, ['allow_always', 'allow_session'], ['allow_always', 'allow_session'])
      : findPermissionOption(options, ['allow_once'], ['allow_once']);
    if (!optionId) {
      return { outcome: { outcome: 'cancelled' } };
    }
    return { outcome: { outcome: 'selected', optionId } };
  }
  const denyOptionId = findPermissionOption(
    options,
    ['reject_once', 'deny', 'reject_always'],
    ['deny', 'reject_once', 'reject_always'],
  );
  if (denyOptionId) {
    return { outcome: { outcome: 'selected', optionId: denyOptionId } };
  }
  return { outcome: { outcome: 'cancelled' } };
}

function readPermissionTool(params: AnyRecord) {
  const toolCall = (params && (params.toolCall || params.tool_call)) || {};
  const toolName = params?.toolName || params?.tool_name || params?.name
    || params?.tool?.name || toolCall.title || 'tool';
  const input = params?.input ?? params?.arguments ?? params?.toolInput ?? params?.tool_input
    ?? toolCall.rawInput ?? toolCall.raw_input ?? toolCall;
  return { toolName, input };
}

/**
 * Answers ONE inbound `session/request_permission` by routing it to the owning
 * run and applying that run's permission mode. Returns the ACP decision the
 * client writes back as the JSON-RPC response.
 */
function routePermissionRequest(sessions: Map<string, OmpSessionEntry>, params: AnyRecord) {
  const sid = params?.sessionId || params?.session_id || null;
  const entry = sid ? sessions.get(sid) : null;
  if (!entry) {
    // No owning run (finished/unknown session) — decline safely. omp surfaces this
    // to the user as a rejection, so say why: a silent "rejected by user" with no
    // prompt is otherwise indistinguishable from a real denial.
    console.warn(`omp approval: no live run for session ${sid} — declining `
      + `(${sessions.size} live run(s))`);
    return { outcome: { outcome: 'cancelled' } };
  }

  const options = Array.isArray(params?.options) ? params.options : [];
  const { toolName, input } = readPermissionTool(params);

  // bypassPermissions: auto-allow without a UI prompt. This IS the path a bypass
  // run takes — it stays on an always-ask child so omp keeps its destructive-command
  // backstop (see APPROVAL_PROFILES), and the auto-allow happens here instead.
  if (entry.permissionMode === 'bypassPermissions') {
    return createPermissionDecision({ allow: true }, options);
  }

  // plan: read-only. omp only hard-guards edit/write/move/delete in plan mode —
  // NOT bash — so any tool reaching this gate in plan mode is auto-DENIED (no UI
  // prompt). Plan-file writes go through omp's `write` tool to a local:// sandbox,
  // which isn't sensitive and never triggers session/request_permission, so
  // planning is unaffected. (Deny → omp throws "rejected by user" before execute.)
  if (entry.permissionMode === 'plan') {
    console.warn(`omp approval: plan mode auto-denied ${toolName} for session ${sid} `
      + '(no UI prompt — omp reports this as rejected by the user)');
    return createPermissionDecision({ allow: false }, options);
  }

  // default: surface a UI approval prompt and await the user's decision,
  // routed back through chat.permission-response → resolveToolApproval.
  const requestId = createRequestId();
  // The client only knows the app id, so prompts and the registry entry are
  // labelled with it; omp's own id would never match a chat.permission-response.
  const clientSessionId = entry.appSessionId ?? entry.sessionId;
  entry.writer.send(createNormalizedMessage({
    kind: 'permission_request',
    requestId,
    toolName,
    input,
    sessionId: clientSessionId,
    provider: PROVIDER,
  }));
  const receivedAt = new Date();
  // Executor form: this file compiles against ES2022 (server/tsconfig.json),
  // which predates Promise.withResolvers.
  return new Promise<AcpPermissionOutcome>((resolve) => {
    registerApproval(requestId, {
      sessionId: clientSessionId,
      provider: PROVIDER,
      // getPendingApprovalsForSession reads these plain keys (reconnect replay).
      meta: { toolName, input, receivedAt },
      resolver: (decision) => {
        unregisterApproval(requestId);
        resolve(createPermissionDecision(decision, options));
      },
    });
  });
}

// --- per-cwd persistent connection manager ---------------------------------
// A dead child is evicted so the next turn respawns.
// No idle reaper: children accumulate per project. Acceptable because each is
// idle and cheap; add a reaper if long-lived servers pile them up.
// Keyed by cwd AND approval profile: the overlay is fixed when the child spawns,
// so a plan run cannot share a child with a gated one. Cost: up to one child per
// PROFILE per cwd — two, since default and bypassPermissions share `gated` (the
// no-reaper note above applies per child). Switching mode
// mid-thread is cheap though — v17.2.2 session/load resumes the same session id on
// the other child, in place and with history (measured), so no fork is minted.
const connectionsByKey = new Map<string, OmpConnection>();
const connectionKey = (workingDir: string, profile: ApprovalProfile) => `${profile}\u0000${workingDir}`;

function createConnection(workingDir: string, profile: ApprovalProfile): OmpConnection {
  // --config carries this profile's overlay (APPROVAL_PROFILES). Both profiles are
  // always-ask, so omp emits session/request_permission and the run gates
  // client-side. Without any overlay omp follows the user's own config, which may
  // be `yolo` — i.e. no gate at all.
  // Read OMP_PATH at call time so it stays overridable (e.g. tests point it at a fake).
  const bin = process.env.OMP_PATH ?? 'omp';
  // omp derives a session's on-disk slug dir by relativizing cwd against $HOME.
  // Dev isolation runs the *app* under a fake HOME, which makes omp store sessions
  // under an absolute-path slug that the user's real-HOME terminal omp can't see.
  // OMP_CHILD_HOME lets the isolated dev launcher give the omp child the REAL home
  // so slugs match the terminal. Unset in production → normal inherited HOME.
  const childEnv = { ...process.env };
  if (process.env.OMP_CHILD_HOME) childEnv.HOME = process.env.OMP_CHILD_HOME;
  const child = spawnFunction(bin, ['acp', '--config', getApprovalOverlayPath(profile)], {
    cwd: workingDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: childEnv,
  });
  // stdio is all "pipe" above, so the streams are non-null.
  const client = new StdioJsonRpcClient(child as ChildProcessWithoutNullStreams, {
    onStderr: (line) => console.error('omp acp stderr:', line),
    onParseError: (rawLine) => console.warn('omp acp non-JSON line:', rawLine.slice(0, 200)),
  });
  const connection: OmpConnection = { child, client, initializeResult: null };

  const key = connectionKey(workingDir, profile);
  const evict = () => {
    if (connectionsByKey.get(key) === connection) {
      connectionsByKey.delete(key);
    }
  };
  child.on('close', evict);
  child.on('error', evict);

  connection.ready = client
    .request('initialize', {
      protocolVersion: 1,
      // fs caps MUST be advertised — omp only asks permission for a tool when it
      // believes the client can handle fs; with both false it never asks. We
      // honor the delegation via the fs/* handlers in attachConnectionHandlers.
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    })
    .then((result) => {
      connection.initializeResult = result as AnyRecord;
      return connection;
    })
    .catch((error) => {
      evict();
      throw error;
    });

  return connection;
}

// Swappable so tests can inject a fake connection (see omp-runtime.test.ts).
let connectionFactory: (workingDir: string, profile: ApprovalProfile) => OmpConnection = createConnection;
export function __setConnectionFactoryForTest(
  factory: ((workingDir: string, profile: ApprovalProfile) => OmpConnection) | null,
) {
  connectionFactory = factory ?? createConnection;
}

// Tests spawn real fake-omp children via the connection manager; without this
// the persistent children keep the event loop alive and hang the test runner.
export function __closeConnectionsForTest() {
  for (const connection of [...connectionsByKey.values(), ...retiringConnections]) {
    try { connection.child?.kill('SIGKILL'); } catch { /* already gone */ }
  }
  connectionsByKey.clear();
  retiringConnections.clear();
  runsByConnection.clear();
}

function attachConnectionHandlers(connection: OmpConnection, workingDir: string) {
  const c = connection.client;
  c.onNotification('session/update', (params: AnyRecord) => {
    routeSessionUpdate(activeOmpSessions, params);
  });
  c.registerRequestHandler('session/request_permission', (params: AnyRecord) => {
    return routePermissionRequest(activeOmpSessions, params);
  });
  // We advertised fs caps (so omp asks) — honor the delegated ops it may send
  // back, symlink-guarded to the run's working dir and size-capped. Errors throw
  // (handleInboundRequest converts them to a JSON-RPC error, never crashes).
  c.registerRequestHandler('fs/read_text_file', async (params: AnyRecord) => {
    const p = await safeReadTarget(workingDir, params?.path);
    const st = await fsp.stat(p);
    if (st.size > FS_MAX_BYTES) {
      throw new Error(`fs/read_text_file: file exceeds ${FS_MAX_BYTES}-byte limit`);
    }
    let content = await fsp.readFile(p, 'utf8');
    // Honor the optional ACP `line` (1-based start) / `limit` (max lines) slice.
    const line = Number.isInteger(params?.line) ? params.line : null;
    const limit = Number.isInteger(params?.limit) ? params.limit : null;
    if (line !== null || limit !== null) {
      const lines = content.split('\n');
      const start = line !== null ? Math.max(0, line - 1) : 0;
      const end = limit !== null ? start + limit : lines.length;
      content = lines.slice(start, end).join('\n');
    }
    return { content };
  });
  c.registerRequestHandler('fs/write_text_file', async (params: AnyRecord) => {
    const content = params?.content;
    if (typeof content !== 'string') {
      throw new Error('fs/write_text_file: content must be a string');
    }
    if (Buffer.byteLength(content, 'utf8') > FS_MAX_BYTES) {
      throw new Error(`fs/write_text_file: content exceeds ${FS_MAX_BYTES}-byte limit`);
    }
    // Path guard first (always applies, session-independent).
    const p = await safeWriteTarget(workingDir, params?.path);
    // Then attribute to a live run and honor its mode. Fail closed: an unknown
    // session must not bypass plan-read-only (F1) — mirror routePermissionRequest.
    const entry = params?.sessionId ? activeOmpSessions.get(params.sessionId) : null;
    if (!entry) {
      throw new Error('fs/write_text_file: no live session for this write');
    }
    if (entry.permissionMode === 'plan') {
      throw new Error('plan mode is read-only; write refused');
    }
    await writeFileNoFollow(p, content);
    return null;
  });
}

async function getConnection(workingDir: string, profile: ApprovalProfile) {
  const key = connectionKey(workingDir, profile);
  let connection = connectionsByKey.get(key);
  if (!connection || connection.client.isClosed()) {
    connection = connectionFactory(workingDir, profile);
    attachConnectionHandlers(connection, workingDir);
    connectionsByKey.set(key, connection);
  }
  // Concurrent same-cwd runs are fine — each gets its own ACP session
  // on the shared child; a shared `ready` promise dedupes the spawn.
  // The claim goes up BEFORE the await: a run that is still waiting on `ready` (or
  // on anything else in setup) has no entry in activeOmpSessions yet, and the
  // reaper must still see it. EVERY successful call hands the caller a claim to
  // release — spawnOmp releases in its finally, connectionInSyncWith on the swap.
  claimConnection(connection);
  try {
    await connection.ready;
  } catch (error) {
    releaseConnection(connection);
    throw error;
  }
  return connection;
}

const loadedSessionsOf = (connection: OmpConnection) => (connection.loadedSessions ??= new Map());

// Runs holding a connection right now, INCLUDING the ones still in setup. Reaping
// on activeOmpSessions alone is not enough: a new-session run has no entry there
// until session/new resolves, so a sibling run that retires the shared child in
// that window would SIGTERM it and reject the first run's in-flight request.
const runsByConnection = new Map<OmpConnection, number>();

function claimConnection(connection: OmpConnection) {
  runsByConnection.set(connection, (runsByConnection.get(connection) ?? 0) + 1);
}

function releaseConnection(connection: OmpConnection) {
  const left = (runsByConnection.get(connection) ?? 1) - 1;
  if (left > 0) {
    runsByConnection.set(connection, left);
  } else {
    runsByConnection.delete(connection);
  }
}

/**
 * Detaches a connection so the NEXT getConnection spawns a fresh child, and kills
 * it once it has no runs left. It is not killed on the spot: one child hosts every
 * session in its (cwd, profile), so an immediate SIGTERM would abort another chat's
 * running turn. Retired children are reaped again at the end of each run.
 */
const retiringConnections = new Set<OmpConnection>();

function retireConnection(workingDir: string, profile: ApprovalProfile, connection: OmpConnection) {
  const key = connectionKey(workingDir, profile);
  if (connectionsByKey.get(key) === connection) {
    connectionsByKey.delete(key);
  }
  retiringConnections.add(connection);
  reapRetiredConnections();
}

function reapRetiredConnections() {
  for (const connection of retiringConnections) {
    if (runsByConnection.has(connection)) {
      continue; // still serving another chat's run, setup included
    }
    retiringConnections.delete(connection);
    // SIGKILL, NOT SIGTERM, and this is the crux of the whole fix. An omp process
    // that exits GRACEFULLY appends `custom/session_exit` under the head it held —
    // for a retired child that head is the abandoned branch — and a later
    // `session/load` resumes from the file's last entry. So a polite kill makes the
    // replacement child resume on the stale branch: exactly the drift we retired it
    // for, re-created by the retirement. Measured end to end: with SIGTERM the web
    // turn after a terminal turn still answered from the pre-terminal snapshot.
    // Nothing is lost by the hard kill — reap only runs when no run holds the child.
    try { connection.child?.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

/**
 * Returns a connection whose in-memory copy of `sessionId` matches the jsonl.
 *
 * `session/load` is a no-op on a child that ALREADY holds that session: it replays
 * its own frozen copy and re-reads nothing (measured on v17.2.2 — a second child
 * appended a turn, the first child's re-load did not see it). So a warm child that
 * loaded a session hours ago keeps answering from that snapshot, and its next turn
 * is written as a SECOND BRANCH off the old head — which is what "I continued my
 * terminal session in the web and it had forgotten the last hour" looks like.
 * The only cure is a fresh process, so retire the stale one (~1s to respawn+load,
 * paid only on a real handover).
 *
 * Known ceiling: the baseline is the file as it stood when OUR turn ended, so a
 * foreign write that lands inside our turn folds into it and the next turn compares
 * equal. The window is the milliseconds between omp's flush and our stat, and the
 * terminal's next write re-opens the drift, so it self-heals — but a truly
 * simultaneous two-way session is not what this detects.
 */
async function connectionInSyncWith(
  connection: OmpConnection,
  workingDir: string,
  profile: ApprovalProfile,
  sessionId: string,
) {
  const loaded = loadedSessionsOf(connection);
  if (!loaded.has(sessionId)) {
    return connection; // this child never held it — its session/load will read disk
  }
  const current = await sessionFileFingerprint(sessionId);
  if (current === loaded.get(sessionId)) {
    return connection;
  }
  console.log(`omp resume: session ${sessionId} changed on disk since this child loaded it `
    + '— respawning so the turn continues from the real transcript');
  retireConnection(workingDir, profile, connection);
  return getConnection(workingDir, profile);
}

// Consumed by `ompRuntime` below (the contract the provider registry calls),
// by `@/modules/agent` for its headless OMP dispatch, and by the provider tests.
export async function spawnOmp(
  command: string,
  options: OmpRunOptions = {},
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
) {
  // The runtime context supplies the registry-backed model/session/auth lookups.
  // Adapters must not import those services directly — they resolve back through
  // the provider registry, which imports this module (cycle).
  const normalizeMessage = (raw: AnyRecord, sid: string | null) => context.normalizeMessage(raw, sid);
  const { sessionId: appSessionId, projectPath, cwd, sessionSummary } = options;
  // Callers hand runtimes the stable app session id; ACP only understands the
  // native id recorded on the session row. It is null until omp announces one,
  // which is exactly what makes a brand-new session start with session/new
  // instead of a load that could never have matched.
  const providerSessionId = context.resolveProviderSessionId(appSessionId ?? null);
  const workingDir = cwd || projectPath || process.cwd();
  const permissionMode = options.permissionMode || 'default';
  const approvalProfile = approvalProfileFor(permissionMode);
  let capturedSessionId = providerSessionId || null;
  let completeSent = false;
  // Held outside the try so the finally can re-baseline this child's copy of the
  // session against the jsonl it just wrote.
  let runConnection: OmpConnection | null = null;
  // The run's entry in activeOmpSessions (created once we have a connection).
  let entry: OmpSessionEntry | null = null;
  let reservedSessionId: string | null = null;
  let setupReservation: OmpSetupReservation | null = null;

  const notifyTerminalState = (
    { error = null, stopReason = 'completed' }: { error?: unknown; stopReason?: string } = {},
  ) => {
    const finalSessionId = capturedSessionId || providerSessionId || null;
    if (!error) {
      notifyRunStopped({
        userId: writer?.userId || null,
        provider: PROVIDER,
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        stopReason,
      });
      return;
    }
    notifyRunFailed({
      userId: writer?.userId || null,
      provider: PROVIDER,
      sessionId: finalSessionId,
      sessionName: sessionSummary,
      error,
    });
  };

  try {
    // Claim a resumed native session before setup yields. The reservation remains
    // until this invocation's finally has fully unwound, including cancellation.
    if (providerSessionId) {
      if (reservedOmpSessionIds.has(providerSessionId) || activeOmpSessions.has(providerSessionId)) {
        throw new Error(`Session "${providerSessionId}" already has a run in progress.`);
      }
      reservedOmpSessionIds.add(providerSessionId);
      reservedSessionId = providerSessionId;
    }
    if (!providerSessionId && appSessionId) {
      if (
        pendingOmpSetups.has(appSessionId)
        || [...activeOmpSessions.values()].some((run) => run.appSessionId === appSessionId)
      ) {
        throw new Error(`Session "${appSessionId}" already has a run in progress.`);
      }
      setupReservation = { aborted: false };
      pendingOmpSetups.set(appSessionId, setupReservation);
    }

    let connection = await getConnection(workingDir, approvalProfile);
    runConnection = connection; // claimed by getConnection; the finally releases it
    if (providerSessionId) {
      // A warm child ignores session/load for a session it already holds, so make
      // sure this one is not answering from a snapshot the terminal has moved past.
      const inSync = await connectionInSyncWith(connection, workingDir, approvalProfile, providerSessionId);
      if (inSync !== connection) {
        releaseConnection(connection); // this run's claim moves to the fresh child
        connection = inSync;
        runConnection = connection;
        reapRetiredConnections(); // the retired one may be free to kill now
      }
    }

    // Resume: register the connection-backed run before session/load so an abort
    // during load can find it. The synchronous reservation already excluded peers.
    if (providerSessionId) {
      entry = {
        connection,
        sessionId: providerSessionId,
        appSessionId: appSessionId ?? null,
        writer,
        sessionSummary,
        permissionMode,
        aborted: false,
        acceptingUpdates: false,
        normalizeMessage,
      };
      activeOmpSessions.set(providerSessionId, entry);
    }
    if (setupReservation?.aborted) {
      notifyTerminalState({ stopReason: 'aborted' });
      return;
    }

    let sessionResult;
    // Which branch a resume takes decides whether the model keeps its history, so
    // it is logged: without this the server records nothing about the resume path
    // and a "it forgot everything" report cannot be told apart from a silent
    // fallback to a blank session.
    let resumePath = providerSessionId ? 'load' : 'new';
    if (providerSessionId && canLoadSession(connection)) {
      try {
        sessionResult = await connection.client.request('session/load', {
          sessionId: providerSessionId,
          cwd: workingDir,
          mcpServers: [],
        });
      } catch (loadError) {
        console.warn(`omp resume: session/load failed for ${providerSessionId} —`,
          (loadError as { message?: string })?.message ?? loadError);
        // On v17.2.2 session/load resumes from disk across processes, so reaching
        // here means something else went wrong (unknown id, unreadable jsonl, a
        // cwd mismatch) — or the agent is an older build where load WAS in-memory
        // only. session/fork resumes FROM DISK: the new session inherits the FULL
        // history + a `parentSession` link, giving true model continuity and a
        // terminal-navigable branch. Falls back to a fresh session if fork fails.
        try {
          sessionResult = await connection.client.request('session/fork', {
            sessionId: providerSessionId,
            cwd: workingDir,
            mcpServers: [],
          });
          resumePath = 'fork';
        } catch (forkError) {
          console.warn(`omp resume: session/fork failed for ${providerSessionId} —`,
            (forkError as { message?: string })?.message ?? forkError);
          sessionResult = await connection.client.request('session/new', { cwd: workingDir, mcpServers: [] });
          resumePath = 'new (history lost)';
        }
      }
    } else {
      if (providerSessionId) {
        resumePath = 'new (history lost: agent did not advertise loadSession)';
      }
      sessionResult = await connection.client.request('session/new', {
        cwd: workingDir,
        mcpServers: [],
      });
    }

    const resolvedId = readSessionId(sessionResult as AnyRecord) || providerSessionId;
    console.log(`omp run: cwd=${workingDir} requested=${providerSessionId ?? '(new)'} resolved=${resolvedId} `
      + `path=${resumePath} permissionMode=${permissionMode} approvalProfile=${approvalProfile}`);
    if (!resolvedId) {
      throw new Error('omp ACP did not return a session id.');
    }
    capturedSessionId = resolvedId;
    if (setupReservation?.aborted) {
      notifyTerminalState({ stopReason: 'aborted' });
      return;
    }

    if (entry) {
      // Resume: adopt any rewritten id, then start accepting live updates.
      if (resolvedId !== entry.sessionId) {
        // A fork or fresh-session fallback minted a new native id. Replace the
        // session's mapping and transcript path together before history or usage
        // can observe the new id with the abandoned source path.
        if (appSessionId) {
          sessionsDb.repointSessionToProviderSession(appSessionId, {
            providerSessionId: resolvedId,
            jsonlPath: await locateOmpSessionFile(resolvedId),
          });
        }
        if (activeOmpSessions.get(entry.sessionId) === entry) {
          activeOmpSessions.delete(entry.sessionId);
        }
        entry.sessionId = resolvedId;
        activeOmpSessions.set(resolvedId, entry);
        // SF-2: the run registry must learn the rewritten id, else handleChatAbort
        // targets the stale id and the abort misses while the turn keeps running.
        if (typeof writer.setSessionId === 'function') {
          writer.setSessionId(resolvedId);
        }
      }
      entry.acceptingUpdates = true;
    } else {
      // New session: create the entry keyed by omp's own id and announce it.
      entry = {
        connection,
        sessionId: resolvedId,
        appSessionId: appSessionId ?? null,
        writer,
        sessionSummary,
        permissionMode,
        aborted: setupReservation?.aborted ?? false,
        acceptingUpdates: true,
        normalizeMessage,
      };
      activeOmpSessions.set(resolvedId, entry);
      if (appSessionId && pendingOmpSetups.get(appSessionId) === setupReservation) {
        pendingOmpSetups.delete(appSessionId);
      }
      if (typeof writer.setSessionId === 'function') {
        writer.setSessionId(resolvedId);
      }
      writer.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: resolvedId,
        cwd: workingDir,
        sessionId: resolvedId,
        provider: PROVIDER,
      }));
    }

    // SF-1: an abort that landed during the session-setup window must not start
    // a turn. Checked here (before the prompt) so a re-keyed resume entry can't
    // be resurrected into a running turn either. handleChatAbort sends the
    // terminal complete; we just notify the aborted stop for consistency.
    if (entry.aborted) {
      notifyTerminalState({ stopReason: 'aborted' });
      return;
    }

    // Apply per-session config (model / thinking / mode). omp config is per ACP
    // session (not persisted by us), so this runs for both new sessions AND
    // resume. session/new|load return configOptions with currentValues — skip a
    // set when the session already has that value (avoids a round-trip). Each set
    // is best-effort (non-fatal; the turn still runs if omp rejects one).
    const initResult = sessionResult as AnyRecord | null | undefined;
    const configOptions = Array.isArray(initResult?.configOptions) ? initResult.configOptions : [];
    const currentConfig = (id: string) => configOptions.find((o: AnyRecord) => o?.id === id)?.currentValue;
    const setConfig = async (configId: string, value: unknown, label: string) => {
      try {
        await connection.client.request('session/set_config_option', { sessionId: resolvedId, configId, value });
      } catch (configError) {
        console.warn(`omp: failed to set ${label}:`, configError instanceof Error ? configError.message : configError);
      }
    };

    const resolvedModel = await context.resolveResumeModel(appSessionId ?? undefined, options.model ?? undefined);
    if (resolvedModel && resolvedModel !== OMP_CONFIGURED_MODEL_SENTINEL && resolvedModel !== currentConfig('model')) {
      await setConfig('model', resolvedModel, 'model');
    }
    // Skip 'default' — omp rejects it ("Unknown ACP thinking level: default"),
    // matching the codex/opencode effort handling.
    const effort = typeof options.effort === 'string' ? options.effort.trim() : '';
    if (effort && effort !== 'default' && effort !== currentConfig('thinking')) {
      await setConfig('thinking', effort, 'thinking');
    }
    if (permissionMode === 'plan' && currentConfig('mode') !== 'plan') {
      await setConfig('mode', 'plan', 'plan mode');
    } else if (permissionMode !== 'plan' && currentConfig('mode') === 'plan') {
      // Un-stick: a resumed session left in plan mode must return to default.
      await setConfig('mode', 'default', 'default mode');
    }

    let stopReason = 'completed';
    if (command && command.trim()) {
      const prompt = await buildAcpPromptBlocks(command, options.images, workingDir);
      if (entry.aborted) {
        notifyTerminalState({ stopReason: 'aborted' });
        return;
      }
      try {
        const promptResult = await connection.client.request(
          'session/prompt',
          { sessionId: resolvedId, prompt },
          { timeoutMs: PROMPT_REQUEST_TIMEOUT_MS },
        );
        stopReason = readStopReason(promptResult as AnyRecord) || 'completed';
        // omp returns no usage in the prompt result — read the last assistant
        // entry's usage from the session jsonl (usage lives per assistant message,
        // not in usage_update deltas) and surface it as a token_budget status.
        const tokenBudget = await readOmpTokenUsage(resolvedId);
        if (tokenBudget) {
          writer.send(createNormalizedMessage({
            kind: 'status',
            text: 'token_budget',
            tokenBudget,
            sessionId: resolvedId,
            provider: PROVIDER,
          }));
        }
      } catch (promptError) {
        // A prompt failure that is NOT a user abort (e.g. the 30-min ceiling)
        // should stop the turn so omp doesn't keep burning tokens on it.
        if (!entry.aborted) {
          try {
            connection.client.notify('session/cancel', { sessionId: resolvedId });
          } catch { /* connection already gone */ }
        }
        throw promptError;
      }
    }

    const wasAborted = Boolean(entry.aborted);
    if (!completeSent && !wasAborted) {
      completeSent = true;
      writer.send(createCompleteMessage({ provider: PROVIDER, sessionId: resolvedId, exitCode: 0 }));
    }
    notifyTerminalState({ stopReason: wasAborted ? 'aborted' : stopReason });
  } catch (error) {
    const finalSessionId = capturedSessionId || providerSessionId || null;
    const aborted = Boolean(entry?.aborted || setupReservation?.aborted);
    // A prompt failure (incl. the 30-min ceiling) leaves any pending approval
    // registered → stale replay. Cancel omp's own pending approvals so awaiting
    // handlers resolve. (abortOmpSession already did this for the abort case.)
    //
    // Key by the id the approval was REGISTERED under: routePermissionRequest
    // labels entries with `appSessionId ?? sessionId`, because the client only
    // ever knows the app id. `finalSessionId` is always omp's native id, so a
    // chat-created run — where the two differ — matched nothing here and left
    // the awaiting ACP request handler hanging.
    const approvalSessionId = entry?.appSessionId ?? entry?.sessionId ?? finalSessionId ?? '';
    for (const approval of getPendingApprovalsForSession(approvalSessionId)) {
      if (approval.provider === PROVIDER) {
        resolveToolApproval(approval.requestId, { cancelled: true });
      }
    }

    // A cancelled session/prompt rejects here; handleChatAbort already sent the
    // aborted terminal `complete`, so don't surface the cancellation as an error.
    if (aborted) {
      return;
    }

    const installed = await context.isProviderInstalled();
    const errorContent = !installed
      ? 'omp is not installed. Install omp (https://omp.sh) and ensure it is on PATH.'
      : error instanceof Error ? error.message : String(error);

    writer.send(createNormalizedMessage({
      kind: 'error',
      content: errorContent,
      sessionId: finalSessionId,
      provider: PROVIDER,
    }));
    if (!completeSent) {
      completeSent = true;
      writer.send(createCompleteMessage({ provider: PROVIDER, sessionId: finalSessionId, exitCode: 1 }));
    }
    notifyTerminalState({ error });
    // No rethrow: match sibling providers (opencode/codex). The WS gateway logs
    // + safety-nets a duplicate complete; the REST path continues to PR steps.
  } finally {
    try {
      // This child now holds the session as of the jsonl it just wrote — record
      // that so only a foreign writer (the terminal) counts as drift next turn.
      // An aborted turn may sample before omp flushes after its cancel notify; the
      // cost is one needless respawn on the next turn, never a stale one.
      if (runConnection && capturedSessionId) {
        loadedSessionsOf(runConnection).set(capturedSessionId, await sessionFileFingerprint(capturedSessionId));
      }
    } finally {
      if (runConnection) {
        releaseConnection(runConnection);
      }
      reapRetiredConnections();
      if (entry && activeOmpSessions.get(entry.sessionId) === entry) {
        activeOmpSessions.delete(entry.sessionId);
      }
      if (reservedSessionId) {
        reservedOmpSessionIds.delete(reservedSessionId);
      }
      if (appSessionId && pendingOmpSetups.get(appSessionId) === setupReservation) {
        pendingOmpSetups.delete(appSessionId);
      }
    }
  }
}

export async function abortOmpSession(sessionId: string) {
  // Clients abort with the app id, while the map is keyed by omp's own id, so a
  // direct miss falls back to the run that owns this app session.
  const entry = activeOmpSessions.get(sessionId)
    ?? [...activeOmpSessions.values()].find((run) => run.appSessionId === sessionId);
  if (!entry) {
    const setup = pendingOmpSetups.get(sessionId);
    if (!setup) {
      return false;
    }
    setup.aborted = true;
    return true;
  }

  entry.aborted = true;

  // Cancel omp's pending approval prompts for this session so the awaiting inbound
  // request handler resolves (otherwise the ACP request hangs forever). Filter by
  // provider — a session id could collide with another provider's approval.
  for (const approval of getPendingApprovalsForSession(entry.appSessionId ?? entry.sessionId)) {
    if (approval.provider === PROVIDER) {
      resolveToolApproval(approval.requestId, { cancelled: true });
    }
  }

  // Graceful per-turn cancel on the shared per-cwd connection. We do NOT SIGTERM
  // the process — it hosts other sessions for this cwd; `session/cancel` stops
  // the current turn and the pending session/prompt rejects into spawnOmp's
  // catch, which skips its own complete (handleChatAbort sends the aborted one).
  // Ownership remains registered until spawnOmp's finally has fully unwound, so
  // a quick retry cannot overlap the cancelled run.
  try {
    entry.connection.client.notify('session/cancel', { sessionId: entry.sessionId });
  } catch {
    // Connection already gone — caller still sees the run as aborted.
  }
  return true;
}

/**
 * IProviderRuntime implementation consumed by the provider registry, which
 * dispatches run/abort and routes tool-approval decisions for every provider.
 */
export const ompRuntime = {
  run: spawnOmp,
  abort: abortOmpSession,
  permissions: {
    resolve: resolveToolApproval,
    listPending: getPendingApprovalsForSession,
  },
};
