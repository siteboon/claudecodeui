import { readObjectRecord } from '@/shared/index.js';

/** Agent routes and module tests use this to collect assistant replies for non-streaming responses. */
export function collectAgentAssistantMessages(messages: unknown[]): unknown[] {
  const assistantMessages: unknown[] = [];
  for (const message of messages) {
    let parsed: unknown = message;
    if (typeof message === 'string') {
      try { parsed = JSON.parse(message); }
      catch { continue; }
    }
    const record = readObjectRecord(parsed);
    if (!record) continue;
    const data = readObjectRecord(record.data);
    if (record.type === 'claude-response' && data?.type === 'assistant') {
      assistantMessages.push(data);
    } else if (['stream_delta', 'text'].includes(String(record.kind))
      && record.role !== 'user' && typeof record.content === 'string') {
      assistantMessages.push(record);
    }
  }
  return assistantMessages;
}
