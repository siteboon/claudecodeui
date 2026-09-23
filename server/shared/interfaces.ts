import type {
  AnyRecord,
  BackgroundTaskSummary,
  FetchHistoryOptions,
  FetchHistoryResult,
  LLMProvider,
  McpScope,
  NormalizedMessage,
  ProviderSkill,
  ProviderSkillListOptions,
  ProviderAuthStatus,
  ProviderCurrentActiveModel,
  ProviderModelsDefinition,
  ProviderMcpServer,
  ProviderSkillCreateInput,
  ProviderSkillRemoveInput,
  ProviderRuntimeContext,
  ProviderRuntimePermissionGateway,
  ProviderRuntimeWriter,
  SessionTranscriptRelocation,
  UpsertProviderMcpServerInput,
  WorkflowAgentActivity,
} from '@/shared/types.js';

//----------------- PROVIDER CONTRACT INTERFACES ------------

/**
 * Live execution contract implemented by each provider SDK/CLI adapter.
 *
 * The provider registry owns this adapter as one facet of `IProvider`; runtime
 * execution context is supplied by the application service at call time.
 */
export interface IProviderRuntime {
  run(
    command: string,
    options: AnyRecord,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown>;
  abort(sessionId: string): boolean | Promise<boolean>;
  permissions?: ProviderRuntimePermissionGateway;
  /**
   * Sessions with background tasks still outstanding, whether or not their
   * turn has ended. Only a runtime that keeps its process open past a turn for
   * such work has anything to report; the others leave this undefined and the
   * running-sessions list falls back to chat runs alone.
   */
  listBackgroundWork?(): Array<{ sessionId: string; tasks: BackgroundTaskSummary[] }>;
  /**
   * Stops one outstanding background task. Resolves false when the session has
   * no live process or that process is not tracking the task — it already
   * settled, or the id was never one of its own.
   */
  stopBackgroundTask?(sessionId: string, taskId: string): Promise<boolean>;
}

/**
 * Main provider contract for CLI and SDK integrations.
 *
 * Each concrete provider owns its MCP/auth handlers plus the provider-specific
 * logic for converting native events/history into the app's normalized shape.
 */
export interface IProvider {
  readonly id: LLMProvider;
  readonly runtime: IProviderRuntime;
  readonly models: IProviderModels;
  readonly mcp: IProviderMcp;
  readonly auth: IProviderAuth;
  readonly skills: IProviderSkills;
  readonly sessions: IProviderSessions;
  readonly sessionSynchronizer: IProviderSessionSynchronizer;
  /**
   * Transcript branching. Present only for providers that can materialise a
   * prefix of one conversation as an independent, resumable provider session;
   * its absence is what makes "fork session" unavailable.
   */
  readonly fork?: IProviderFork;
  /**
   * Keeps transcripts resumable when a project folder is renamed or moved.
   * Present only for providers whose artifacts are laid out by project path;
   * a provider without it keeps its artifacts where they are.
   */
  readonly transcriptRelocation?: IProviderTranscriptRelocation;
}

// ---------------------------
//----------------- PROVIDER FORK INTERFACE ------------
/**
 * Transcript-branching contract for one provider.
 */
export interface IProviderFork {
  /**
   * Copies a session's transcript, up to and including `upToAnchorId` (the
   * whole conversation when omitted), into a brand-new provider session.
   *
   * Returns the new provider-native id and the path of the artifact it wrote,
   * so the caller can insert the database row before the filesystem watcher
   * notices the file and indexes it as an unrelated session.
   */
  forkSession(input: {
    providerSessionId: string;
    jsonlPath: string;
    /** The session's working directory — how providers scope a session lookup. */
    projectPath: string;
    upToAnchorId?: string;
    title?: string;
  }): Promise<{ providerSessionId: string; jsonlPath: string }>;
}

// ---------------------------
//----------------- PROVIDER TRANSCRIPT RELOCATION INTERFACE ------------
/**
 * Contract for following a project folder that was renamed or moved outside
 * the app.
 *
 * Providers that find a transcript again from the cwd a session runs in, or
 * that re-derive a session's project from a cwd recorded in the transcript,
 * implement this so the session stays resumable and is not moved back to the
 * old folder by the next synchronization.
 */
export interface IProviderTranscriptRelocation {
  /**
   * Moves or rewrites the given sessions' transcripts so they belong to
   * `newProjectPath`, and returns the ones it touched with their new paths.
   *
   * All or nothing: a failure undoes this call's filesystem changes before it
   * rethrows, so the caller can restore its rows and nothing on disk
   * contradicts them. Sessions the provider cannot place are skipped and left
   * out of the result.
   */
  relocateTranscripts(input: {
    sessions: SessionTranscriptRelocation[];
    oldProjectPath: string;
    newProjectPath: string;
  }): Promise<SessionTranscriptRelocation[]>;
}

// ---------------------------
//----------------- PROVIDER MODEL INTERFACE ------------
/**
 * Model catalog contract for one provider.
 *
 * Implementations supply CloudCLI's curated predefined models and can inspect
 * provider-native session state. The Providers service merges these immutable
 * source-controlled definitions with user-created SQLite rows at read time.
 */
export interface IProviderModels {
  /**
   * Returns the curated predefined catalog owned by this provider adapter.
   */
  getSupportedModels(): Promise<ProviderModelsDefinition>;

  /**
   * Reads the model the provider itself believes one session is running with.
   *
   * Only consulted for sessions the app has never recorded a model for — a
   * session started directly in the provider CLI, for example. Selecting a
   * model in the app is persisted on the session row instead, so adapters here
   * are read-only and must fall back to the catalog default when the
   * provider-specific lookup finds nothing.
   */
  getCurrentActiveModel(sessionId?: string): Promise<ProviderCurrentActiveModel>;
}

// ---------------------------
//----------------- PROVIDER AUTH INTERFACE ------------
/**
 * Auth contract for one provider.
 *
 * Implementations should return a complete installation/authentication status
 * without throwing for normal "not installed" or "not authenticated" states.
 */
export interface IProviderAuth {
  /**
   * Checks whether the provider is installed and has usable credentials.
   */
  getStatus(): Promise<ProviderAuthStatus>;
}

// ---------------------------
//----------------- PROVIDER SKILLS INTERFACE ------------
/**
 * Skills contract for one provider.
 *
 * Implementations discover provider-native skill markdown locations and return
 * normalized skill records with the exact command syntax expected by that
 * provider. Each skill is read from a `SKILL.md` file under its skill directory.
 */
export interface IProviderSkills {
  /**
   * Lists all skills visible to this provider for the optional workspace.
   */
  listSkills(options?: ProviderSkillListOptions): Promise<ProviderSkill[]>;

  /**
   * Writes one or more global user-scoped skills for this provider.
   *
   * Implementations should install the supplied markdown entries into the
   * provider's writable user skill folder and return the normalized skill
   * records that were written.
   */
  addSkills(input: ProviderSkillCreateInput): Promise<ProviderSkill[]>;

  removeSkill(
    input: ProviderSkillRemoveInput,
  ): Promise<{ removed: boolean; provider: LLMProvider; directoryName: string }>;
}

// ---------------------------
//----------------- PROVIDER MCP INTERFACE ------------
/**
 * MCP contract for one provider.
 *
 * Implementations must map provider-native MCP config formats to shared
 * `ProviderMcpServer` records used by routes and frontend state.
 */
export interface IProviderMcp {
  listServers(options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>>;
  listServersForScope(scope: McpScope, options?: { workspacePath?: string }): Promise<ProviderMcpServer[]>;
  upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer>;
  removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }>;
}

// ---------------------------
//----------------- PROVIDER SESSION INTERFACE ------------
/**
 * Session/history contract for one provider.
 *
 * Implementations normalize provider-specific events and message history into
 * shared transport shapes consumed by API routes and realtime streams.
 */
export interface IProviderSessions {
  normalizeMessage(raw: unknown, sessionId: string | null): NormalizedMessage[];
  fetchHistory(sessionId: string, options?: FetchHistoryOptions): Promise<FetchHistoryResult>;

  /**
   * Resolves where a conversation must resume from so that the turn identified
   * by `anchorId`, and everything after it, is replaced.
   *
   * `resumeThroughId` is the last transcript row to KEEP — resuming is
   * inclusive of it — or `null` when the edited turn is the first prompt and
   * the conversation should start over. `found` is false when `anchorId` is not
   * in the transcript, which the caller must report rather than guess at.
   *
   * Implemented only by providers whose transcripts have stable per-row
   * identity; its absence is what makes "edit this message" unavailable.
   */
  resolveEditAnchor?(
    sessionId: string,
    anchorId: string,
  ): Promise<{ found: boolean; resumeThroughId: string | null }>;

  /**
   * Rewinds the session so `keepThroughId` is the last row of its
   * conversation, and points the session at whatever provider session now
   * holds it. `null` keeps nothing: the conversation starts over.
   *
   * Implemented only by providers whose runtime cannot resume a transcript
   * partway and have to branch instead. Codex is one — it has no
   * resume-at-a-row, so the rewind is a `thread/fork` that leaves the pre-edit
   * thread on disk and moves the session onto the copy. Providers that can
   * resume partway leave this undefined, and the anchor is handed to their
   * runtime as a resume option instead; that is the difference the edit
   * gateway branches on.
   */
  rewindSession?(sessionId: string, keepThroughId: string | null): Promise<void>;

  /**
   * Reads what one agent of a workflow run did, from the transcript the run
   * wrote for it, with the status its journal gives it. Returns `null` when the
   * run left no transcript for that agent.
   *
   * Implemented only by providers whose runtime spawns workflow agents; its
   * absence is what makes an agent's timeline unavailable in the card.
   */
  readWorkflowAgentActivity?(
    sessionId: string,
    runId: string,
    agentId: string,
  ): Promise<WorkflowAgentActivity | null>;
}

// ---------------------------
//----------------- PROVIDER SESSION SYNCHRONIZER INTERFACE ------------
/**
 * Session indexing contract for one provider.
 *
 * Implementations scan provider-specific session artifacts on disk and upsert
 * normalized session metadata into the database. The service layer uses this
 * interface for both full rescans and single-file incremental sync triggered
 * by filesystem watcher events.
 */
export interface IProviderSessionSynchronizer {
  /**
   * Scans provider session artifacts and upserts discovered sessions into DB.
   */
  synchronize(since?: Date): Promise<number>;

  /**
   * Parses and upserts one provider artifact file without running a full scan.
   */
  synchronizeFile(filePath: string): Promise<string | null>;
}
