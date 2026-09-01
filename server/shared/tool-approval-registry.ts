import type { LLMProvider, ProviderPermissionDecision } from '@/shared/types.js';

/**
 * A resolver settles the turn waiting on one approval: either with the user's
 * decision, or with `{cancelled:true}` when the approval is swept away.
 */
type ApprovalResolver = (outcome: ProviderPermissionDecision | { cancelled: true }) => void;

type ApprovalCancellation = () => void;

type ApprovalMeta = {
  toolName?: string;
  _toolName?: string;
  input?: unknown;
  _input?: unknown;
  context?: unknown;
  _context?: unknown;
  receivedAt?: Date;
  _receivedAt?: Date;
};

type PendingApproval = {
  resolver: ApprovalResolver;
  onCancel?: ApprovalCancellation;
  sessionId: string | null;
  provider: LLMProvider | null;
  meta: ApprovalMeta;
  receivedAt: Date;
};

/** One pending approval as reported to a client resubscribing to its session. */
type PendingApprovalView = {
  requestId: string;
  toolName: string;
  input: unknown;
  context: unknown;
  sessionId: string;
  provider: LLMProvider | null;
  receivedAt: Date;
};

const pendingApprovals = new Map<string, PendingApproval>();
const APPROVAL_MAX_AGE_MS = 30 * 60 * 1000;

// `meta` crosses a JS boundary - the Claude runtime is still JavaScript, so its
// declared `Date` buys nothing at runtime and a string (or an unparseable Date)
// reaches us. Pin a real timestamp at registration: an entry whose age cannot be
// read would be immortal in the sweep below, and would break the `receivedAt`
// contract of the pending-approval replay that clients resubscribe with.
function coerceReceivedAt(value: unknown): Date {
  const time = value instanceof Date ? value.getTime() : Number.NaN;
  return Number.isFinite(time) ? (value as Date) : new Date();
}

// Drop approvals whose run died without resolving them (WS disconnect, process
// crash) so their captured payloads/closures don't accumulate unbounded.
function sweepExpiredApprovals(now = Date.now()): void {
  for (const [requestId, entry] of pendingApprovals) {
    const receivedAt = entry.receivedAt instanceof Date ? entry.receivedAt.getTime() : Number.NaN;
    // Unknown age expires rather than persists: the fail-safe direction is to
    // unblock a waiter we can no longer reason about, not to hang it forever.
    if (!Number.isFinite(receivedAt) || now - receivedAt > APPROVAL_MAX_AGE_MS) {
      // Consume first so cancellation cannot re-enter through a late response.
      // Emit the runtime cancellation before settling the waiter, otherwise
      // replay can retain an unresolvable permission request.
      unregisterApproval(requestId);
      try {
        entry.onCancel?.();
      } catch (error) {
        console.warn(
          `[Approvals] emitting cancellation for ${requestId} threw:`,
          error instanceof Error ? error.message : error,
        );
      }
      try {
        entry.resolver({ cancelled: true });
      } catch (error) {
        console.warn(
          `[Approvals] cancelling ${requestId} threw; its turn may stay parked:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }
}

// Registration-time sweeping alone leaves the LAST stalled approval pending
// forever: nothing else calls the sweep, and unlike the Claude runtime (which
// applies its own per-request timeout) the omp ACP handler awaits its resolver
// indefinitely. An unref'd interval bounds that wait without holding the process
// open, and only runs while approvals are actually outstanding.
const SWEEP_INTERVAL_MS = 60 * 1000;
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function stopSweepTimer(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

function ensureSweepTimer(): void {
  if (sweepTimer || pendingApprovals.size === 0) {
    return;
  }
  sweepTimer = setInterval(() => {
    sweepExpiredApprovals();
    if (pendingApprovals.size === 0) {
      stopSweepTimer();
    }
  }, SWEEP_INTERVAL_MS);
  // Never keep the event loop (or a test run) alive just to sweep.
  sweepTimer.unref?.();
}

// Consumed by permission-capable runtimes in `@/modules/providers` (Claude
// and OMP) to park a turn until the user answers its permission prompt.
export function registerApproval(
  requestId: string,
  {
    resolver,
    onCancel,
    sessionId = null,
    provider = null,
    meta = {},
  }: {
    resolver: ApprovalResolver;
    onCancel?: ApprovalCancellation;
    sessionId?: string | null;
    provider?: LLMProvider | null;
    meta?: ApprovalMeta;
  },
): void {
  if (!requestId || typeof resolver !== 'function') {
    return;
  }

  sweepExpiredApprovals();

  pendingApprovals.set(requestId, {
    resolver,
    onCancel,
    sessionId,
    provider,
    meta,
    receivedAt: coerceReceivedAt(meta.receivedAt || meta._receivedAt),
  });
  ensureSweepTimer();
}

// Consumed by the provider runtimes' own cleanup paths: a turn that settled,
// timed out, or aborted drops its approval without settling the resolver twice.
export function unregisterApproval(requestId: string): void {
  pendingApprovals.delete(requestId);
  if (pendingApprovals.size === 0) {
    stopSweepTimer();
  }
}

// Consumed by the provider runtimes, which re-expose it as
// `runtime.permissions.resolve` so the websocket module's
// `chat.permission-response` handler can settle the waiting turn. Callers also
// settle an approval as cancelled (abort / stale replay), which is not a user
// decision — hence the same union the resolver accepts.
export function resolveToolApproval(
  requestId: string,
  decision: ProviderPermissionDecision | { cancelled: true },
): boolean {
  const entry = pendingApprovals.get(requestId);
  if (!entry) {
    return false;
  }

  // Consume BEFORE settling. A duplicate or late `chat.permission-response`, or
  // an abort racing the user's click, must not hand a second decision to a
  // resolver that already settled - and a provider that forgets its own cleanup
  // must not leak the entry.
  unregisterApproval(requestId);
  try {
    entry.resolver(decision);
  } catch (error) {
    // Consuming first means a throw here is the provider's resolver failing, not
    // a double-settle, and the entry is already gone so the sweep cannot retry it.
    // Report rather than lose the turn silently; the boolean still answers only
    // "did this request exist", which is all the websocket handler decides on.
    console.warn(
      `[Approvals] the resolver for ${requestId} threw; its turn may stay parked:`,
      error instanceof Error ? error.message : error,
    );
  }
  return true;
}

// Consumed by the provider runtimes as `runtime.permissions.listPending`, so
// `@/modules/websocket` can replay outstanding prompts to a client that
// resubscribes to a session mid-approval.
export function getPendingApprovalsForSession(sessionId: string): PendingApprovalView[] {
  const pending: PendingApprovalView[] = [];
  for (const [requestId, entry] of pendingApprovals.entries()) {
    if (entry.sessionId !== sessionId) {
      continue;
    }

    pending.push({
      requestId,
      toolName: entry.meta.toolName || entry.meta._toolName || 'UnknownTool',
      input: entry.meta.input ?? entry.meta._input,
      context: entry.meta.context ?? entry.meta._context,
      sessionId,
      provider: entry.provider,
      receivedAt: entry.receivedAt,
    });
  }

  return pending;
}
