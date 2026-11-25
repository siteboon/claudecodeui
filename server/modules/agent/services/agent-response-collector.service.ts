import { readObjectRecord } from '@/shared/index.js';

/** Agent routes and module tests collect one representation of each assistant reply. */
export function collectAgentAssistantMessages(messages: unknown[]): unknown[] {
  const assistantMessages: unknown[] = [];
  const pending = new Map<string, number[][]>();
  const replaced = new Set<number>();
  const ended = new Set<string>();
  for (const message of messages) {
    let parsed: unknown = message;
    if (typeof message === 'string') {
      try { parsed = JSON.parse(message); }
      catch { continue; }
    }
    const record = readObjectRecord(parsed);
    if (!record) continue;
    const key = `${String(record.provider ?? 'claude')}\0${String(record.sessionId ?? '')}\0${String(record.parentToolUseId ?? '')}`;
    const data = readObjectRecord(record.data);
    const legacy = record.type === 'claude-response' && data?.type === 'assistant';
    if (legacy || (record.kind === 'text' && record.role !== 'user' && typeof record.content === 'string')) {
      // A final row replaces deltas from this reply, never another session or
      // an earlier stream that ended without a final row.
      const groups = pending.get(key) ?? [];
      const finalContent = legacy ? readObjectRecord(data?.message)?.content : record.content;
      const finalTexts = typeof finalContent === 'string' ? [finalContent]
        : Array.isArray(finalContent) ? finalContent.flatMap((block) => {
          const text = readObjectRecord(block)?.text;
          return typeof text === 'string' ? [text] : [];
        }) : [];
      // Claude emits block stops before the final assistant frames. Match each
      // text block while preserving earlier replies that only streamed deltas.
      let matched = false;
      for (const text of finalTexts) {
        const replyId = record.assistantReplyId;
        const groupIndex = typeof replyId === 'string' && replyId
          ? groups.findIndex((group) => {
            const delta = readObjectRecord(assistantMessages[group[0]]);
            // SDK finals may contain a single block without its native index.
            // Consume the first outstanding block of that exact reply in order.
            return delta?.assistantReplyId === replyId &&
              (record.assistantBlockIndex === undefined || delta.assistantBlockIndex === record.assistantBlockIndex);
          })
          : record.provider === 'claude' || legacy || ended.has(key)
          ? groups.findIndex((group) => group.map((index) => readObjectRecord(assistantMessages[index])?.content ?? '').join('') === text)
          : groups.length - 1;
        if (groupIndex < 0) continue;
        matched = true;
        for (const index of groups[groupIndex]) replaced.add(index);
        groups.splice(groupIndex, 1);
      }
      if (!record.assistantReplyId && !ended.has(key) && finalTexts.length > 0 && !matched && groups.length > 0) {
        for (const index of groups.pop()!) replaced.add(index);
      }
      if (groups.length === 0) pending.delete(key);
      assistantMessages.push(legacy ? data : record);
    } else if (record.kind === 'stream_delta' && record.role !== 'user' && typeof record.content === 'string') {
      // A new stream after a stop begins another reply; a final immediately
      // after a block stop still replaces the preceding streamed text.
      const groups = pending.get(key) ?? [];
      const previous = groups.length ? readObjectRecord(assistantMessages[groups[groups.length - 1][0]]) : null;
      if (ended.delete(key) || groups.length === 0 || (record.assistantReplyId &&
        (previous?.assistantReplyId !== record.assistantReplyId || previous?.assistantBlockIndex !== record.assistantBlockIndex))) groups.push([]);
      groups[groups.length - 1].push(assistantMessages.length);
      pending.set(key, groups);
      assistantMessages.push(record);
    } else if (record.kind === 'stream_end') {
      ended.add(key);
    } else if (record.kind === 'complete') {
      pending.delete(key);
      ended.delete(key);
    }
  }
  return assistantMessages.filter((_message, index) => !replaced.has(index));
}
