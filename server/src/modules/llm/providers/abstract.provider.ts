import { AppError } from '@/shared/utils/app-error.js';
import type {
  IProvider,
  MutableProviderSession,
  ProviderCapabilities,
  ProviderExecutionFamily,
  ProviderModel,
  ProviderSessionEvent,
  ProviderSessionSnapshot,
  StartSessionInput,
} from '@/modules/llm/providers/provider.interface.js';
import type { LLMProvider } from '@/shared/types/app.js';

type SessionPreference = {
  model?: string;
  thinkingMode?: string;
};

const MAX_EVENT_BUFFER_SIZE = 2_000;

/**
 * Shared provider base for session lifecycle state and capability gating.
 */
export abstract class AbstractProvider implements IProvider {
  readonly id: LLMProvider;
  readonly family: ProviderExecutionFamily;
  readonly capabilities: ProviderCapabilities;

  protected readonly sessions = new Map<string, MutableProviderSession>();
  protected readonly sessionPreferences = new Map<string, SessionPreference>();

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
   * Waits for a running session to complete and returns the final snapshot.
   */
  async waitForSession(sessionId: string): Promise<ProviderSessionSnapshot | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    await session.completion;
    return this.toSnapshot(session);
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
      });
    }

    return stopped;
  }

  /**
   * Validates/supports model switching and updates both live and persisted state.
   */
  async setSessionModel(sessionId: string, model: string): Promise<void> {
    if (!this.capabilities.supportsModelSwitching) {
      throw new AppError(`Provider "${this.id}" does not support model switching.`, {
        code: 'MODEL_SWITCH_NOT_SUPPORTED',
        statusCode: 400,
      });
    }

    const trimmedModel = model.trim();
    if (!trimmedModel) {
      throw new AppError('Model cannot be empty.', {
        code: 'INVALID_MODEL',
        statusCode: 400,
      });
    }

    const session = this.sessions.get(sessionId);
    if (session?.setModel) {
      await session.setModel(trimmedModel);
    }

    const currentPreference = this.sessionPreferences.get(sessionId) ?? {};
    this.sessionPreferences.set(sessionId, { ...currentPreference, model: trimmedModel });

    if (session) {
      session.model = trimmedModel;
      this.appendEvent(session, {
        timestamp: new Date().toISOString(),
        channel: 'system',
        message: `Model updated to "${trimmedModel}".`,
      });
    }
  }

  /**
   * Validates/supports thinking mode updates and applies them to live/persisted state.
   */
  async setSessionThinkingMode(sessionId: string, thinkingMode: string): Promise<void> {
    if (!this.capabilities.supportsThinkingModeControl) {
      throw new AppError(`Provider "${this.id}" does not support thinking mode control.`, {
        code: 'THINKING_MODE_NOT_SUPPORTED',
        statusCode: 400,
      });
    }

    const trimmedMode = thinkingMode.trim();
    if (!trimmedMode) {
      throw new AppError('Thinking mode cannot be empty.', {
        code: 'INVALID_THINKING_MODE',
        statusCode: 400,
      });
    }

    const session = this.sessions.get(sessionId);
    if (session?.setThinkingMode) {
      await session.setThinkingMode(trimmedMode);
    }

    const currentPreference = this.sessionPreferences.get(sessionId) ?? {};
    this.sessionPreferences.set(sessionId, { ...currentPreference, thinkingMode: trimmedMode });

    if (session) {
      session.thinkingMode = trimmedMode;
      this.appendEvent(session, {
        timestamp: new Date().toISOString(),
        channel: 'system',
        message: `Thinking mode updated to "${trimmedMode}".`,
      });
    }
  }

  /**
   * Reads saved preferences for resumed sessions.
   */
  protected getSessionPreference(sessionId: string): SessionPreference {
    return this.sessionPreferences.get(sessionId) ?? {};
  }

  /**
   * Stores session preferences for subsequent resume/start operations.
   */
  protected rememberSessionPreference(sessionId: string, preference: SessionPreference): void {
    const currentPreference = this.sessionPreferences.get(sessionId) ?? {};
    this.sessionPreferences.set(sessionId, {
      ...currentPreference,
      ...preference,
    });
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
    this.rememberSessionPreference(sessionId, {
      model: input.model,
      thinkingMode: input.thinkingMode,
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
