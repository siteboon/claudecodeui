import type { MessageKind, NormalizedMessage } from './useSessionStore';

interface RealtimeMessageMergeOptions {
  currentMessages: NormalizedMessage[];
  incomingMessages: NormalizedMessage[];
  serverMessages?: NormalizedMessage[];
  maxMessages?: number;
}

interface RealtimeMessageMergeResult {
  messages: NormalizedMessage[];
  changed: boolean;
}

const THINKING_DUPLICATE_WINDOW_MS = 2_500;

function isSequenceOnlyIdentityKind(kind: MessageKind): boolean {
  return kind === 'text' || kind === 'stream_delta' || kind === 'thinking';
}

function messagesShareProviderSession(a: NormalizedMessage, b: NormalizedMessage): boolean {
  return a.provider === b.provider && a.sessionId === b.sessionId;
}

function sequencesAreCompatible(a: NormalizedMessage, b: NormalizedMessage): boolean {
  return a.sequence === undefined || b.sequence === undefined || a.sequence === b.sequence;
}

function messageText(msg: NormalizedMessage): string | null {
  for (const value of [msg.content, msg.text]) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }

  return null;
}

function timestampsAreNear(a: NormalizedMessage, b: NormalizedMessage): boolean {
  const aTime = Date.parse(a.timestamp);
  const bTime = Date.parse(b.timestamp);

  return (
    Number.isFinite(aTime)
    && Number.isFinite(bTime)
    && Math.abs(aTime - bTime) <= THINKING_DUPLICATE_WINDOW_MS
  );
}

function hasMatchingThinkingFallback(a: NormalizedMessage, b: NormalizedMessage): boolean {
  if (a.kind !== 'thinking' || b.kind !== 'thinking') return false;
  if (!messagesShareProviderSession(a, b)) return false;
  if (
    a.rowid !== undefined
    || b.rowid !== undefined
    || a.sequence !== undefined
    || b.sequence !== undefined
  ) {
    return false;
  }

  const aText = messageText(a);
  const bText = messageText(b);

  return aText !== null && aText === bText && timestampsAreNear(a, b);
}

export function hasStableRealtimeIdentity(a: NormalizedMessage, b: NormalizedMessage): boolean {
  if (a.id === b.id) return true;

  if (
    a.kind === 'session_created'
    && b.kind === 'session_created'
    && a.newSessionId
    && a.newSessionId === b.newSessionId
  ) {
    return true;
  }

  if (a.kind !== b.kind) return false;

  if (
    a.rowid !== undefined
    && b.rowid !== undefined
    && a.rowid === b.rowid
    && messagesShareProviderSession(a, b)
    && sequencesAreCompatible(a, b)
  ) {
    return true;
  }

  if (hasMatchingThinkingFallback(a, b)) {
    return true;
  }

  return (
    isSequenceOnlyIdentityKind(a.kind)
    && a.sequence !== undefined
    && b.sequence !== undefined
    && a.sequence === b.sequence
    && messagesShareProviderSession(a, b)
  );
}

export function isServerBackedRealtimeMessage(
  serverMessages: NormalizedMessage[],
  msg: NormalizedMessage,
): boolean {
  return serverMessages.some(existing => hasStableRealtimeIdentity(existing, msg));
}

export function upsertRealtimeMessage(
  messages: NormalizedMessage[],
  msg: NormalizedMessage,
): NormalizedMessage[] {
  const existingIndex = messages.findIndex(existing => hasStableRealtimeIdentity(existing, msg));

  if (existingIndex === -1) {
    return [...messages, msg];
  }

  const next = [...messages];
  next[existingIndex] = {
    ...messages[existingIndex],
    ...msg,
  };
  return next;
}

export function mergeRealtimeMessages({
  currentMessages,
  incomingMessages,
  serverMessages = [],
  maxMessages,
}: RealtimeMessageMergeOptions): RealtimeMessageMergeResult {
  let messages = currentMessages;
  let changed = false;

  for (const msg of incomingMessages) {
    if (isServerBackedRealtimeMessage(serverMessages, msg)) continue;
    messages = upsertRealtimeMessage(messages, msg);
    changed = true;
  }

  if (!changed) {
    return { messages: currentMessages, changed: false };
  }

  if (maxMessages !== undefined && messages.length > maxMessages) {
    messages = messages.slice(-maxMessages);
  }

  return { messages, changed: true };
}
