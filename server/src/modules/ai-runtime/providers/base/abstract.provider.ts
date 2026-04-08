import type {
  IProvider,
  IProviderAuthRuntime,
  IProviderMcpRuntime,
  IProviderSessionSynchronizerRuntime,
  IProviderSkillsRuntime,
  MutableProviderSession,
  ProviderCapabilities,
  ProviderExecutionFamily,
  ProviderModel,
  ProviderSessionEvent,
  ProviderSessionSnapshot,
  StartSessionInput,
} from '@/modules/ai-runtime/types/index.js';
import type { LLMProvider } from '@/shared/types/app.js';

const MAX_EVENT_BUFFER_SIZE = 2_000;

/**
 * Shared provider base for session lifecycle state and capability gating.
 */
export abstract class AbstractProvider implements IProvider {
  readonly id: LLMProvider;
  readonly family: ProviderExecutionFamily;
  readonly capabilities: ProviderCapabilities;
  abstract readonly mcp: IProviderMcpRuntime;
  abstract readonly skills: IProviderSkillsRuntime;
  abstract readonly sessionSynchronizer: IProviderSessionSynchronizerRuntime;
  abstract readonly auth: IProviderAuthRuntime;

  protected readonly sessions = new Map<string, MutableProviderSession>();

  protected constructor(
    id: LLMProvider,
    family: ProviderExecutionFamily,
    capabilities: ProviderCapabilities,
  ) {
    this.id = id;
    this.family = family;
    this.capabilities = capabilities;
  }

  abstract listModels(): Promise<ProviderModel[]>;
  abstract launchSession(input: StartSessionInput): Promise<ProviderSessionSnapshot>;
  abstract resumeSession(
    input: StartSessionInput & { sessionId: string },
  ): Promise<ProviderSessionSnapshot>;

  /**
   * Returns one in-memory session snapshot when present.
   */
  getSession(sessionId: string): ProviderSessionSnapshot | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return this.toSnapshot(session);
  }

  /**
   * Returns snapshots of all in-memory sessions.
   */
  listSessions(): ProviderSessionSnapshot[] {
    return [...this.sessions.values()].map((session) => this.toSnapshot(session));
  }

  /**
   * Requests a graceful session stop.
   */
  async stopSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    const stopped = await session.stop();
    if (stopped && session.status === 'running') {
      this.updateSessionStatus(session, 'stopped');
      this.appendEvent(session, {
        timestamp: new Date().toISOString(),
        channel: 'system',
        message: 'Session stop requested.',
        data: {
          sessionId,
          sessionStatus: 'SESSION_ABORTED',
        },
      });
    }

    return stopped;
  }

  /**
   * Creates mutable internal session state and registers it in memory.
   */
  protected createSessionRecord(
    sessionId: string,
    input: {
      model?: string;
      thinkingMode?: string;
    },
  ): MutableProviderSession {
    const session: MutableProviderSession = {
      sessionId,
      provider: this.id,
      family: this.family,
      status: 'running',
      startedAt: new Date().toISOString(),
      model: input.model,
      thinkingMode: input.thinkingMode,
      events: [],
      completion: Promise.resolve(),
      stop: async () => false,
    };

    this.sessions.set(sessionId, session);

    this.appendEvent(session, {
      timestamp: session.startedAt,
      channel: 'system',
      message: 'Session started.',
      data: {
        sessionId,
        sessionStatus: 'STARTED',
      },
    });

    return session;
  }

  /**
   * Appends an event while enforcing the configured ring-buffer size.
   */
  protected appendEvent(session: MutableProviderSession, event: ProviderSessionEvent): void {
    session.events.push(event);

    if (session.events.length > MAX_EVENT_BUFFER_SIZE) {
      session.events.splice(0, session.events.length - MAX_EVENT_BUFFER_SIZE);
    }
  }

  /**
   * Marks the terminal state for a session.
   */
  protected updateSessionStatus(
    session: MutableProviderSession,
    status: MutableProviderSession['status'],
    error?: string,
  ): void {
    session.status = status;
    session.endedAt = new Date().toISOString();
    session.error = error;
  }

  /**
   * Converts mutable internal session state to an external snapshot.
   */
  protected toSnapshot(session: MutableProviderSession): ProviderSessionSnapshot {
    return {
      sessionId: session.sessionId,
      provider: session.provider,
      family: session.family,
      status: session.status,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      model: session.model,
      thinkingMode: session.thinkingMode,
      events: [...session.events],
      error: session.error,
    };
  }
}
