import { randomUUID } from 'node:crypto';

import { AbstractProvider } from '@/modules/llm/providers/abstract.provider.js';
import type {
  MutableProviderSession,
  ProviderCapabilities,
  ProviderSessionEvent,
  ProviderSessionSnapshot,
  StartSessionInput,
} from '@/modules/llm/providers/provider.interface.js';
import type { LLMProvider } from '@/shared/types/app.js';

type CreateSdkExecutionInput = StartSessionInput & {
  sessionId: string;
  isResume: boolean;
};

type SdkExecution = {
  stream: AsyncIterable<unknown>;
  stop: () => Promise<boolean>;
  setModel?: (model: string) => Promise<void>;
  setThinkingMode?: (thinkingMode: string) => Promise<void>;
};

/**
 * Base class for SDK-driven providers with async stream consumption.
 */
export abstract class BaseSdkProvider extends AbstractProvider {
  protected constructor(providerId: LLMProvider, capabilities: ProviderCapabilities) {
    super(providerId, 'sdk', capabilities);
  }

  /**
   * Starts a new SDK session and begins event streaming.
   */
  async launchSession(input: StartSessionInput): Promise<ProviderSessionSnapshot> {
    return this.startSessionInternal({
      ...input,
      sessionId: input.sessionId ?? randomUUID(),
      isResume: false,
    });
  }

  /**
   * Resumes an existing SDK session and begins event streaming.
   */
  async resumeSession(input: StartSessionInput & { sessionId: string }): Promise<ProviderSessionSnapshot> {
    return this.startSessionInternal({
      ...input,
      isResume: true,
    });
  }

  /**
   * Implemented by concrete SDK providers to create a running execution.
   */
  protected abstract createSdkExecution(input: CreateSdkExecutionInput): Promise<SdkExecution>;

  /**
   * Normalizes raw SDK events to the shared event shape.
   */
  protected mapSdkEvent(rawEvent: unknown): ProviderSessionEvent | null {
    return {
      timestamp: new Date().toISOString(),
      channel: 'sdk',
      data: rawEvent,
    };
  }

  /**
   * Initializes one SDK execution and wires it to the internal session record.
   */
  private async startSessionInternal(input: CreateSdkExecutionInput): Promise<ProviderSessionSnapshot> {
    const preferred = this.getSessionPreference(input.sessionId);
    const effectiveModel = input.model ?? preferred.model;
    const effectiveThinking = input.thinkingMode ?? preferred.thinkingMode;

    const session = this.createSessionRecord(input.sessionId, {
      model: effectiveModel,
      thinkingMode: effectiveThinking,
    });

    let execution: SdkExecution;
    try {
      execution = await this.createSdkExecution({
        ...input,
        model: effectiveModel,
        thinkingMode: effectiveThinking,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start SDK session';
      this.updateSessionStatus(session, 'failed', message);
      this.appendEvent(session, {
        timestamp: new Date().toISOString(),
        channel: 'error',
        message,
      });
      throw error;
    }

    session.stop = execution.stop;
    session.setModel = execution.setModel;
    session.setThinkingMode = execution.setThinkingMode;

    session.completion = this.consumeStream(session, execution.stream);
    return this.toSnapshot(session);
  }

  /**
   * Drains SDK events until completion/error and updates final status.
   */
  private async consumeStream(
    session: MutableProviderSession,
    stream: AsyncIterable<unknown>,
  ): Promise<void> {
    try {
      for await (const sdkEvent of stream) {
        const normalized = this.mapSdkEvent(sdkEvent);
        if (normalized) {
          this.appendEvent(session, normalized);
        }
      }

      if (session.status === 'running') {
        this.updateSessionStatus(session, 'completed');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown SDK execution failure';

      if (session.status === 'stopped') {
        this.appendEvent(session, {
          timestamp: new Date().toISOString(),
          channel: 'system',
          message: 'Session stopped.',
        });
        return;
      }

      this.updateSessionStatus(session, 'failed', message);
      this.appendEvent(session, {
        timestamp: new Date().toISOString(),
        channel: 'error',
        message,
      });
    }
  }
}
