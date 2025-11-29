const STORAGE_KEY_PREFIX = 'claude-ui:permissions:';
const REQUEST_TTL_MS = 60 * 60 * 1000;

export function getPendingRequests(sessionId) {
  if (!sessionId) return [];
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (!stored) return [];
    const requests = JSON.parse(stored);
    return requests.filter(r => Date.now() - r.timestamp < REQUEST_TTL_MS);
  } catch {
    return [];
  }
}

export function savePendingRequest(sessionId, request) {
  if (!sessionId) return;
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  const existing = getPendingRequests(sessionId);
  const updated = [
    ...existing.filter(r => r.id !== request.id),
    { ...request, timestamp: request.timestamp || Date.now() }
  ];
  try {
    sessionStorage.setItem(key, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to persist permission request:', e);
  }
}

export function removePendingRequest(sessionId, requestId) {
  if (!sessionId) return;
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  const existing = getPendingRequests(sessionId);
  const updated = existing.filter(r => r.id !== requestId);
  try {
    if (updated.length > 0) {
      sessionStorage.setItem(key, JSON.stringify(updated));
    } else {
      sessionStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('Failed to update permission storage:', e);
  }
}

export function clearAllRequests(sessionId) {
  if (!sessionId) return;
  const key = `${STORAGE_KEY_PREFIX}${sessionId}`;
  sessionStorage.removeItem(key);
}

export function isRequestExpired(request) {
  if (!request || !request.timestamp) return true;
  return Date.now() - request.timestamp >= REQUEST_TTL_MS;
}

export function getRequestTTL() {
  return REQUEST_TTL_MS;
}
