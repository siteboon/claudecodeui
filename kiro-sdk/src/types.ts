/**
 * kiro-sdk type definitions
 *
 * Mirrors @anthropic-ai/claude-agent-sdk type patterns where possible
 * so consumers can swap providers with minimal code changes.
 */

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type Options = {
  /** Working directory for the session. Defaults to process.cwd(). */
  cwd?: string;

  /** Session ID to resume. Mutually exclusive with creating a new session. */
  resume?: string;

  /** Model ID (e.g. 'claude-sonnet-4.6'). Omit or 'auto' for default. */
  model?: string;

  /** Agent profile name (maps to kiro-cli --agent). */
  agent?: string;

  /** Auto-approve all tool permission requests. */
  trustAllTools?: boolean;

  /** Trust only these specific tools. */
  trustTools?: string[];

  /** AbortController for cancellation. */
  abortController?: AbortController;

  /** MCP server configurations to pass to the session. */
  mcpServers?: Record<string, unknown>[];
};

// ---------------------------------------------------------------------------
// Messages (yielded by the async generator)
// ---------------------------------------------------------------------------

/** Streaming text chunk from the agent. Maps to ACP AgentMessageChunk. */
export type KiroAssistantMessage = {
  type: 'assistant';
  content: string;
  session_id: string;
};

/** Tool invocation. Maps to ACP ToolCall. */
export type KiroToolUseMessage = {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
  id: string;
  status: 'running' | 'completed' | 'error';
  session_id: string;
};

/** Progress update for a running tool. Maps to ACP ToolCallUpdate. */
export type KiroToolProgressMessage = {
  type: 'tool_progress';
  content: string;
  tool_id: string;
  session_id: string;
};

/** Agent turn completed. Maps to ACP TurnEnd. */
export type KiroResultMessage = {
  type: 'result';
  session_id: string;
  is_error: boolean;
  /** Aggregated full text of the turn (convenience field). */
  text: string;
};

/** Union of all message types yielded by Query. */
export type KiroMessage =
  | KiroAssistantMessage
  | KiroToolUseMessage
  | KiroToolProgressMessage
  | KiroResultMessage;

// ---------------------------------------------------------------------------
// Query (the async generator returned by query())
// ---------------------------------------------------------------------------

export interface Query extends AsyncGenerator<KiroMessage, void, undefined> {
  /** Cancel the current turn. The generator will end after cleanup. */
  interrupt(): Promise<void>;

  /** Change the model for subsequent turns. */
  setModel(model: string): Promise<void>;

  /** The ACP session ID (available after first yield). */
  readonly sessionId: string | null;
}

// ---------------------------------------------------------------------------
// ACP transport types (internal, but exported for advanced use)
// ---------------------------------------------------------------------------

export type AcpCapabilities = {
  loadSession: boolean;
  promptCapabilities: {
    image: boolean;
  };
};

export type AcpInitializeResult = {
  protocolVersion: number;
  agentCapabilities: AcpCapabilities;
  agentInfo: {
    name: string;
    version: string;
  };
};

export type AcpSessionResult = {
  sessionId: string;
};
