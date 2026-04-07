import type { ProviderSessionEvent } from '@/modules/ai-runtime/types/index.js';
import type { LLMProvider } from '@/shared/types/app.js';

export type UnifiedMessageType =
  | 'user_message'
  | 'thinking_message'
  | 'assistant_message'
  | 'assistant_error_message'
  | 'tool_use_request'
  | 'tool_call_success'
  | 'tool_call_error'
  | 'todo_task_list'
  | 'session_started'
  | 'session_completed'
  | 'session_interrupted';

export type UnifiedSessionStatus = 'STARTED' | 'COMPLETED' | 'SESSION_ABORTED';

export type UnifiedChatMessage = {
  timestamp: string;
  provider: LLMProvider;
  sessionId: string;
  type: UnifiedMessageType;
  text?: string;
  images?: string[];
  toolName?: string;
  toolCallId?: string;
  status?: 'success' | 'error';
  has_progress_indicator?: boolean;
  sessionStatus?: UnifiedSessionStatus;
  data?: unknown;
  raw?: unknown;
};

type MessageContext = {
  provider: LLMProvider;
  sessionId: string;
  timestamp?: string;
};

/**
 * Unifies provider-specific history/event payloads into one frontend-safe message contract.
 */
export const llmMessagesUnifier = {
  /**
   * Converts in-memory provider session events to unified chat messages.
   */
  normalizeSessionEvents(
    provider: LLMProvider,
    sessionId: string,
    events: ProviderSessionEvent[],
  ): UnifiedChatMessage[] {
    const messages: UnifiedChatMessage[] = [];
    for (const event of events) {
      const normalized = this.normalizeUnknown(provider, sessionId, event.data ?? event.message ?? event, event.timestamp);
      if (normalized.length === 0 && event.message) {
        messages.push(createMessage({
          provider,
          sessionId,
          timestamp: event.timestamp,
          type: event.channel === 'error' ? 'assistant_error_message' : 'assistant_message',
          text: event.message,
          raw: event,
        }));
        continue;
      }

      messages.push(...normalized);
    }

    return messages;
  },

  /**
   * Converts DB history payload entries to unified chat messages.
   */
  normalizeHistoryEntries(
    provider: LLMProvider,
    sessionId: string,
    entries: unknown[],
  ): UnifiedChatMessage[] {
    const messages: UnifiedChatMessage[] = [];
    for (const entry of entries) {
      messages.push(...this.normalizeUnknown(provider, sessionId, entry));
    }

    return messages;
  },

  /**
   * Converts one raw provider payload to zero-or-more normalized messages.
   */
  normalizeUnknown(
    provider: LLMProvider,
    sessionId: string,
    raw: unknown,
    timestamp?: string,
  ): UnifiedChatMessage[] {
    const context: MessageContext = { provider, sessionId, timestamp };
    if (!raw || typeof raw !== 'object') {
      return [];
    }

    const preUnified = normalizePreUnifiedPayload(raw as Record<string, unknown>, context);
    if (preUnified) {
      return preUnified;
    }

    if (provider === 'claude') {
      return normalizeClaudePayload(raw as Record<string, unknown>, context);
    }

    if (provider === 'codex') {
      return normalizeCodexPayload(raw as Record<string, unknown>, context);
    }

    if (provider === 'gemini') {
      return normalizeGeminiPayload(raw as Record<string, unknown>, context);
    }

    return normalizeCursorPayload(raw as Record<string, unknown>, context);
  },
};

/**
 * Maps already-unified custom payloads (for example permission callbacks) without provider parsing.
 */
function normalizePreUnifiedPayload(
  raw: Record<string, unknown>,
  context: MessageContext,
): UnifiedChatMessage[] | null {
  const type = readString(raw.type);
  if (!type) {
    return null;
  }

  if (
    type !== 'user_message' &&
    type !== 'thinking_message' &&
    type !== 'assistant_message' &&
    type !== 'assistant_error_message' &&
    type !== 'tool_use_request' &&
    type !== 'tool_call_success' &&
    type !== 'tool_call_error' &&
    type !== 'todo_task_list' &&
    type !== 'session_started' &&
    type !== 'session_completed' &&
    type !== 'session_interrupted'
  ) {
    return null;
  }

  const statusValue = readString(raw.status);
  const status =
    statusValue === 'success' || statusValue === 'error'
      ? statusValue
      : undefined;
  const sessionStatus = readString(raw.sessionStatus);
  const normalizedSessionStatus =
    sessionStatus === 'STARTED' || sessionStatus === 'COMPLETED' || sessionStatus === 'SESSION_ABORTED'
      ? sessionStatus
      : undefined;
  const hasProgressIndicator =
    readBoolean(raw.has_progress_indicator) ?? readBoolean(raw.hasProgressIndicator);

  return [
    createMessage({
      ...context,
      timestamp: readString(raw.timestamp) ?? context.timestamp,
      type,
      text: readString(raw.text) ?? readString(raw.message),
      images: readStringArray(raw.images),
      toolName: readString(raw.toolName) ?? readString(raw.name),
      toolCallId: readString(raw.toolCallId) ?? readString(raw.toolUseID) ?? readString(raw.call_id),
      status,
      has_progress_indicator: hasProgressIndicator,
      sessionStatus: normalizedSessionStatus,
      data: raw.data ?? raw.input ?? raw.payload,
      raw,
    }),
  ];
}

/**
 * Normalizes Claude payloads from both SDK stream and disk history.
 */
function normalizeClaudePayload(
  raw: Record<string, unknown>,
  context: MessageContext,
): UnifiedChatMessage[] {
  const sessionStatusMessage = normalizeSessionStatus(raw, context);
  if (sessionStatusMessage) {
    return [sessionStatusMessage];
  }

  const type = readString(raw.type);
  const timestamp = readString(raw.timestamp) ?? context.timestamp;

  if (type === 'assistant') {
    const messages: UnifiedChatMessage[] = [];
    if (readString(raw.error)) {
      messages.push(createMessage({
        ...context,
        timestamp,
        type: 'assistant_error_message',
        text: readString(raw.error),
        raw,
      }));
    }

    const messageRecord = readRecord(raw.message);
    const contentBlocks = readArray(messageRecord?.content);
    for (const contentBlock of contentBlocks) {
      const block = readRecord(contentBlock);
      if (!block) {
        continue;
      }

      const blockType = readString(block.type);
      if (blockType === 'thinking') {
        const thinkingText = readString(block.thinking) ?? 'Thinking';
        messages.push(createMessage({
          ...context,
          timestamp,
          type: 'thinking_message',
          text: thinkingText.length ? thinkingText : 'Thinking',
          raw: block,
        }));
        continue;
      }

      if (blockType === 'text') {
        const text = readString(block.text);
        if (text) {
          messages.push(createMessage({
            ...context,
            timestamp,
            type: 'assistant_message',
            text,
            raw: block,
          }));
        }
        continue;
      }

      if (blockType === 'tool_use') {
        const toolName = readString(block.name);
        const toolInput = readRecord(block.input) ?? block.input;

        if (toolName === 'TaskCreate' || toolName === 'TaskUpdate') {
          messages.push(createMessage({
            ...context,
            timestamp,
            type: 'todo_task_list',
            toolName,
            has_progress_indicator: true,
            data: toolInput,
            raw: block,
          }));
          continue;
        }

        messages.push(createMessage({
          ...context,
          timestamp,
          type: 'tool_use_request',
          toolName,
          toolCallId: readString(block.id),
          data: toolInput,
          raw: block,
        }));
      }
    }

    return messages;
  }

  if (type === 'user') {
    // Tool results are emitted as user messages in Claude JSONL and should be treated as assistant tool results.
    if (raw.toolUseResult !== undefined) {
      const toolUseResult = readRecord(raw.toolUseResult) ?? raw.toolUseResult;
      const successValue = readBoolean((toolUseResult as Record<string, unknown>)?.success);
      const status: 'success' | 'error' = successValue === false ? 'error' : 'success';

      return [
        createMessage({
          ...context,
          timestamp,
          type: status === 'success' ? 'tool_call_success' : 'tool_call_error',
          status,
          data: toolUseResult,
          raw,
        }),
      ];
    }

    const messageRecord = readRecord(raw.message);
    const content = readArray(messageRecord?.content);
    const textParts: string[] = [];
    const images: string[] = [];
    for (const contentBlock of content) {
      const block = readRecord(contentBlock);
      if (!block) {
        continue;
      }

      if (readString(block.type) === 'text') {
        const text = readString(block.text);
        if (text) {
          textParts.push(text);
        }
      }

      if (readString(block.type) === 'image') {
        const source = readRecord(block.source);
        const data = readString(source?.data);
        if (data) {
          images.push(data);
        }
      }
    }

    if (!textParts.length && !images.length) {
      return [];
    }

    return [
      createMessage({
        ...context,
        timestamp,
        type: 'user_message',
        text: textParts.join('\n'),
        images: images.length ? images : undefined,
        raw,
      }),
    ];
  }

  return [];
}

/**
 * Normalizes Codex payloads from SDK stream/history JSONL.
 */
function normalizeCodexPayload(
  raw: Record<string, unknown>,
  context: MessageContext,
): UnifiedChatMessage[] {
  const sessionStatusMessage = normalizeSessionStatus(raw, context);
  if (sessionStatusMessage) {
    return [sessionStatusMessage];
  }

  const timestamp = readString(raw.timestamp) ?? context.timestamp;
  const type = readString(raw.type);

  if (type === 'error') {
    return [
      createMessage({
        ...context,
        timestamp,
        type: 'assistant_error_message',
        text: readString(raw.message) ?? 'Codex stream error',
        raw,
      }),
    ];
  }

  if (type === 'event_msg') {
    const payload = readRecord(raw.payload);
    const payloadType = readString(payload?.type);
    if (payloadType === 'user_message') {
      const text = readString(payload?.message);
      const localImages = readStringArray(payload?.local_images);
      const remoteImages = readStringArray(payload?.images);
      return [
        createMessage({
          ...context,
          timestamp,
          type: 'user_message',
          text,
          images: [...localImages, ...remoteImages],
          raw,
        }),
      ];
    }

    if (payloadType === 'exec_command_end') {
      const status = readString(payload?.status) === 'failed' ? 'error' : 'success';
      return [
        createMessage({
          ...context,
          timestamp,
          type: status === 'success' ? 'tool_call_success' : 'tool_call_error',
          status,
          toolName: 'shell_command',
          toolCallId: readString(payload?.call_id),
          data: payload,
          raw,
        }),
      ];
    }
  }

  if (type === 'response_item') {
    const payload = readRecord(raw.payload);
    const payloadType = readString(payload?.type);
    if (payloadType === 'reasoning') {
      const summary = readArray(payload?.summary);
      const summaryText = summary
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry;
          }
          const record = readRecord(entry);
          return readString(record?.text) ?? readString(record?.summary) ?? '';
        })
        .filter((entry) => entry.length > 0)
        .join('\n');

      return [
        createMessage({
          ...context,
          timestamp,
          type: 'thinking_message',
          text: summaryText || 'Reasoning',
          data: payload,
          raw,
        }),
      ];
    }

    if (payloadType === 'function_call') {
      const toolName = readString(payload?.name);
      const toolCallId = readString(payload?.call_id);
      const argsText = readString(payload?.arguments);
      const parsedArgs = parseJsonSafely(argsText) ?? argsText;

      if (toolName === 'update_plan') {
        return [
          createMessage({
            ...context,
            timestamp,
            type: 'todo_task_list',
            toolName,
            toolCallId,
            has_progress_indicator: true,
            data: parsedArgs,
            raw,
          }),
        ];
      }

      return [
        createMessage({
          ...context,
          timestamp,
          type: 'tool_use_request',
          toolName,
          toolCallId,
          data: parsedArgs,
          raw,
        }),
      ];
    }

    if (payloadType === 'function_call_output') {
      const output = readString(payload?.output) ?? '';
      const status: 'success' | 'error' = /exit code:\s*0/i.test(output) ? 'success' : 'error';
      return [
        createMessage({
          ...context,
          timestamp,
          type: status === 'success' ? 'tool_call_success' : 'tool_call_error',
          status,
          toolCallId: readString(payload?.call_id),
          text: output,
          data: payload,
          raw,
        }),
      ];
    }

    if (payloadType === 'message') {
      const role = readString(payload?.role);
      const content = readArray(payload?.content);
      const text = content
        .map((entry) => {
          const block = readRecord(entry);
          return readString(block?.text) ?? '';
        })
        .filter(Boolean)
        .join('\n');

      if (role === 'user' && text.includes('<turn_aborted>')) {
        return [
          createMessage({
            ...context,
            timestamp,
            type: 'session_interrupted',
            sessionStatus: 'SESSION_ABORTED',
            text,
            raw,
          }),
        ];
      }

      return [
        createMessage({
          ...context,
          timestamp,
          type: role === 'user' ? 'user_message' : 'assistant_message',
          text,
          data: payload,
          raw,
        }),
      ];
    }

    if (payloadType === 'error') {
      return [
        createMessage({
          ...context,
          timestamp,
          type: 'assistant_error_message',
          text: readString(payload?.message) ?? 'Codex error',
          data: payload,
          raw,
        }),
      ];
    }
  }

  // SDK thread item-based events
  const item = readRecord(raw.item);
  if (!item) {
    return [];
  }

  const itemType = readString(item.type);
  if (itemType === 'reasoning') {
    const text = readString(item.summary) ?? 'Reasoning';
    return [createMessage({ ...context, timestamp, type: 'thinking_message', text, raw })];
  }

  if (itemType === 'error') {
    return [
      createMessage({
        ...context,
        timestamp,
        type: 'assistant_error_message',
        text: readString(item.message) ?? 'Codex item error',
        raw,
      }),
    ];
  }

  if (itemType === 'todo_list') {
    return [
      createMessage({
        ...context,
        timestamp,
        type: 'todo_task_list',
        has_progress_indicator: true,
        data: item,
        raw,
      }),
    ];
  }

  if (itemType === 'agent_message') {
    return [
      createMessage({
        ...context,
        timestamp,
        type: 'assistant_message',
        text: readString(item.message) ?? '',
        raw,
      }),
    ];
  }

  return [];
}

/**
 * Normalizes Gemini payloads from JSON history files and runtime stream chunks.
 */
function normalizeGeminiPayload(
  raw: Record<string, unknown>,
  context: MessageContext,
): UnifiedChatMessage[] {
  const sessionStatusMessage = normalizeSessionStatus(raw, context);
  if (sessionStatusMessage) {
    return [sessionStatusMessage];
  }

  if (Array.isArray(raw.messages)) {
    const messages: UnifiedChatMessage[] = [];
    for (const message of raw.messages) {
      const parsedMessage = readRecord(message);
      if (!parsedMessage) {
        continue;
      }

      messages.push(...normalizeGeminiPayload(parsedMessage, context));
    }
    return messages;
  }

  const timestamp = readString(raw.timestamp) ?? context.timestamp;
  const type = readString(raw.type);
  const unified: UnifiedChatMessage[] = [];

  if (type === 'user') {
    const text = readArray(raw.content)
      .map((entry) => readString(readRecord(entry)?.text) ?? '')
      .filter(Boolean)
      .join('\n');
    unified.push(createMessage({
      ...context,
      timestamp,
      type: 'user_message',
      text,
      raw,
    }));
  }

  if (type === 'gemini') {
    const assistantText = readString(raw.content) ?? '';
    if (assistantText.length) {
      unified.push(createMessage({
        ...context,
        timestamp,
        type: 'assistant_message',
        text: assistantText,
        raw,
      }));
    }
  }

  const thoughts = readArray(raw.thoughts);
  for (const thought of thoughts) {
    const thoughtRecord = readRecord(thought);
    if (!thoughtRecord) {
      continue;
    }
    const text = readString(thoughtRecord.description) ?? readString(thoughtRecord.subject) ?? 'Thinking';
    unified.push(createMessage({
      ...context,
      timestamp: readString(thoughtRecord.timestamp) ?? timestamp,
      type: 'thinking_message',
      text,
      raw: thoughtRecord,
    }));
  }

  const toolCalls = readArray(raw.toolCalls);
  for (const toolCall of toolCalls) {
    const toolRecord = readRecord(toolCall);
    if (!toolRecord) {
      continue;
    }

    const status = readString(toolRecord.status) === 'error' ? 'error' : 'success';
    unified.push(createMessage({
      ...context,
      timestamp: readString(toolRecord.timestamp) ?? timestamp,
      type: status === 'success' ? 'tool_call_success' : 'tool_call_error',
      status,
      toolName: readString(toolRecord.displayName) ?? readString(toolRecord.name),
      toolCallId: readString(toolRecord.id),
      data: {
        args: toolRecord.args,
        result: toolRecord.result,
        resultDisplay: toolRecord.resultDisplay,
      },
      raw: toolRecord,
    }));
  }

  return unified;
}

/**
 * Normalizes Cursor payloads from JSONL entries.
 */
function normalizeCursorPayload(
  raw: Record<string, unknown>,
  context: MessageContext,
): UnifiedChatMessage[] {
  const sessionStatusMessage = normalizeSessionStatus(raw, context);
  if (sessionStatusMessage) {
    return [sessionStatusMessage];
  }

  const role = readString(raw.role);
  const timestamp = readString(raw.timestamp) ?? context.timestamp;
  const message = readRecord(raw.message);
  const content = readArray(message?.content);
  const normalized: UnifiedChatMessage[] = [];

  if (role === 'user') {
    const text = content
      .map((entry) => readString(readRecord(entry)?.text) ?? '')
      .filter(Boolean)
      .join('\n');
    const strippedText = stripCursorUserQueryTags(text);
    if (!strippedText) {
      return [];
    }

    return [
      createMessage({
        ...context,
        timestamp,
        type: 'user_message',
        text: strippedText,
        raw,
      }),
    ];
  }

  if (role !== 'assistant') {
    return [];
  }

  for (const entry of content) {
    const block = readRecord(entry);
    if (!block) {
      continue;
    }

    const blockType = readString(block.type);
    if (blockType === 'text') {
      const text = readString(block.text);
      if (!text) {
        continue;
      }

      normalized.push(createMessage({
        ...context,
        timestamp,
        type: 'assistant_message',
        text,
        raw: block,
      }));
      continue;
    }

    if (blockType === 'tool_use') {
      const toolName = readString(block.name);
      const input = block.input;
      if (toolName === 'CreatePlan') {
        normalized.push(createMessage({
          ...context,
          timestamp,
          type: 'todo_task_list',
          toolName,
          has_progress_indicator: false,
          data: input,
          raw: block,
        }));
        continue;
      }

      normalized.push(createMessage({
        ...context,
        timestamp,
        type: 'tool_call_success',
        status: 'success',
        toolName,
        data: input,
        raw: block,
      }));
    }
  }

  return normalized;
}

/**
 * Maps shared session status payloads into unified session event message types.
 */
function normalizeSessionStatus(
  raw: Record<string, unknown>,
  context: MessageContext,
): UnifiedChatMessage | null {
  const sessionStatus = readString(raw.sessionStatus);
  if (!sessionStatus) {
    return null;
  }

  if (sessionStatus === 'STARTED') {
    return createMessage({
      ...context,
      timestamp: readString(raw.timestamp) ?? context.timestamp,
      type: 'session_started',
      sessionStatus: 'STARTED',
      raw,
    });
  }

  if (sessionStatus === 'COMPLETED') {
    return createMessage({
      ...context,
      timestamp: readString(raw.timestamp) ?? context.timestamp,
      type: 'session_completed',
      sessionStatus: 'COMPLETED',
      raw,
    });
  }

  if (sessionStatus === 'SESSION_ABORTED') {
    return createMessage({
      ...context,
      timestamp: readString(raw.timestamp) ?? context.timestamp,
      type: 'session_interrupted',
      sessionStatus: 'SESSION_ABORTED',
      raw,
    });
  }

  return null;
}

/**
 * Strips cursor `<user_query>...</user_query>` wrappers from user messages.
 */
function stripCursorUserQueryTags(value: string): string {
  return value
    .replace(/<user_query>/gi, '')
    .replace(/<\/user_query>/gi, '')
    .trim();
}

/**
 * Creates one normalized message with defaults.
 */
function createMessage(input: Omit<UnifiedChatMessage, 'timestamp'> & { timestamp?: string }): UnifiedChatMessage {
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

/**
 * Safe object record cast.
 */
function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

/**
 * Safe array cast.
 */
function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Safe string parser.
 */
function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Safe boolean parser.
 */
function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Safe string-array parser.
 */
function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Best-effort JSON parse helper.
 */
function parseJsonSafely(value?: string): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
