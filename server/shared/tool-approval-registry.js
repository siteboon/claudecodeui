const pendingApprovals = new Map();
const APPROVAL_MAX_AGE_MS = 30 * 60 * 1000;

// Drop approvals whose run died without resolving them (WS disconnect, process
// crash) so their captured payloads/closures don't accumulate unbounded.
function sweepExpiredApprovals(now = Date.now()) {
  for (const [requestId, entry] of pendingApprovals) {
    const receivedAt = entry.receivedAt instanceof Date ? entry.receivedAt.getTime() : 0;
    if (receivedAt && now - receivedAt > APPROVAL_MAX_AGE_MS) {
      pendingApprovals.delete(requestId);
    }
  }
}

function clearApprovalsForSession(sessionId) {
  if (!sessionId) {
    return;
  }
  for (const [requestId, entry] of pendingApprovals) {
    if (entry.sessionId === sessionId) {
      pendingApprovals.delete(requestId);
    }
  }
}

function registerApproval(requestId, { resolver, sessionId = null, provider = null, meta = {} } = {}) {
  if (!requestId || typeof resolver !== 'function') {
    return;
  }

  sweepExpiredApprovals();

  pendingApprovals.set(requestId, {
    resolver,
    sessionId,
    provider,
    meta,
    receivedAt: meta.receivedAt || meta._receivedAt || new Date(),
  });
}

function unregisterApproval(requestId) {
  pendingApprovals.delete(requestId);
}

function resolveToolApproval(requestId, decision) {
  const entry = pendingApprovals.get(requestId);
  if (!entry) {
    return false;
  }

  entry.resolver(decision);
  return true;
}

function getPendingApprovalsForSession(sessionId) {
  const pending = [];
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

export {
  registerApproval,
  unregisterApproval,
  resolveToolApproval,
  getPendingApprovalsForSession,
  clearApprovalsForSession,
};
