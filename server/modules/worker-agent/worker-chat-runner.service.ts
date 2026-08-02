import { providerRegistry } from '@/modules/providers/index.js';
import type {
  AnyRecord,
  LLMProvider,
  NormalizedMessage,
  ProviderPermissionDecision,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  WorkerProtocolMessage,
} from '@/shared/types.js';

import { createWorkerNativeArtifactsService } from './worker-native-artifacts.service.js';

type WorkerChatRunnerDependencies = {
  send(message: WorkerProtocolMessage): void;
};

type ActiveLocalRun = {
  sessionId: string;
  provider: LLMProvider;
  abort: () => Promise<boolean>;
};

/**
 * Creates the Worker-side chat executor used by `cloudcli worker`.
 *
 * Runs provider CLIs/SDKs on this machine so native transcript files land in
 * the local provider directories (required for native resume), while streaming
 * normalized events back to the Server over the worker websocket.
 */
export function createWorkerChatRunner(dependencies: WorkerChatRunnerDependencies) {
  const activeRuns = new Map<string, ActiveLocalRun>();
  const nativeArtifacts = createWorkerNativeArtifactsService();

  return {
    async handleChatRun(message: WorkerProtocolMessage): Promise<void> {
      const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
      const provider = message.provider as LLMProvider | undefined;
      const command = typeof message.command === 'string' ? message.command : '';
      const options = (message.options ?? {}) as AnyRecord;
      const providerSessionId =
        typeof message.providerSessionId === 'string' ? message.providerSessionId : null;
      const projectPath =
        (typeof options.cwd === 'string' && options.cwd) ||
        (typeof options.projectPath === 'string' && options.projectPath) ||
        null;

      if (!sessionId || !provider) {
        dependencies.send({
          type: 'worker.error',
          sessionId,
          error: 'chat.run requires sessionId and provider',
        });
        return;
      }

      if (activeRuns.has(sessionId)) {
        dependencies.send({
          type: 'worker.error',
          sessionId,
          error: `Session "${sessionId}" already has a local run`,
        });
        return;
      }

      let capturedProviderSessionId = providerSessionId;
      let aborted = false;
      const providerAdapter = providerRegistry.resolveProvider(provider);

      const writer: ProviderRuntimeWriter = {
        send(data: unknown) {
          if (!data || typeof data !== 'object' || typeof (data as AnyRecord).kind !== 'string') {
            return;
          }
          const record = data as AnyRecord;
          if (record.kind === 'session_created') {
            const announced =
              (typeof record.newSessionId === 'string' && record.newSessionId) ||
              (typeof record.sessionId === 'string' && record.sessionId) ||
              null;
            if (announced) {
              capturedProviderSessionId = announced;
            }
          }
          dependencies.send({
            type: 'worker.event',
            sessionId,
            event: data as NormalizedMessage,
          });
        },
        setSessionId(nextId: string) {
          if (nextId) {
            capturedProviderSessionId = nextId;
          }
        },
      };

      const context: ProviderRuntimeContext = {
        resolveProviderSessionId: () => capturedProviderSessionId,
        resolveResumeModel: async () =>
          typeof options.model === 'string' ? options.model : undefined,
        getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
        normalizeMessage: (raw, sid) => providerAdapter.sessions.normalizeMessage(raw, sid),
        isProviderInstalled: async () => true,
      };

      activeRuns.set(sessionId, {
        sessionId,
        provider,
        abort: async () => {
          aborted = true;
          return Boolean(await providerAdapter.runtime.abort(sessionId));
        },
      });

      let exitCode = 0;
      let jsonlPath: string | null = null;
      try {
        await providerAdapter.runtime.run(
          command,
          {
            ...options,
            sessionId,
          },
          writer,
          context,
        );
      } catch (error) {
        exitCode = 1;
        const content = error instanceof Error ? error.message : String(error);
        dependencies.send({
          type: 'worker.event',
          sessionId,
          event: {
            kind: 'error',
            id: `worker-error-${Date.now()}`,
            sessionId,
            timestamp: new Date().toISOString(),
            content,
            provider,
          },
        });
      } finally {
        if (capturedProviderSessionId) {
          try {
            jsonlPath = await nativeArtifacts.resolveNativePath(
              provider,
              capturedProviderSessionId,
              projectPath,
            );
          } catch {
            // Path reporting is best-effort; the run already finished.
          }
        }

        activeRuns.delete(sessionId);
        dependencies.send({
          type: 'worker.run_complete',
          sessionId,
          providerSessionId: capturedProviderSessionId,
          jsonlPath,
          success: exitCode === 0 && !aborted,
          exitCode: aborted ? 0 : exitCode,
          aborted,
        });
      }
    },

    async handleChatAbort(message: WorkerProtocolMessage): Promise<void> {
      const sessionId = typeof message.sessionId === 'string' ? message.sessionId : '';
      const active = sessionId ? activeRuns.get(sessionId) : undefined;
      if (!active) {
        return;
      }
      await active.abort();
    },

    handlePermissionResponse(message: WorkerProtocolMessage): void {
      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      if (!requestId) {
        return;
      }
      const decision: ProviderPermissionDecision = {
        allow: Boolean(message.allow),
        updatedInput: message.updatedInput,
        message: typeof message.message === 'string' ? message.message : undefined,
        rememberEntry: message.rememberEntry,
      };
      for (const provider of providerRegistry.listProviders()) {
        provider.runtime.permissions?.resolve(requestId, decision);
      }
    },

    async handleEnsureNative(message: WorkerProtocolMessage): Promise<void> {
      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      const provider = message.provider as LLMProvider | undefined;
      const providerSessionId =
        typeof message.providerSessionId === 'string' ? message.providerSessionId : null;
      const projectPath =
        typeof message.projectPath === 'string' ? message.projectPath : null;

      if (!requestId || !provider) {
        dependencies.send({
          type: 'session.native_ready',
          requestId,
          success: false,
          error: 'session.ensure_native requires requestId and provider',
        });
        return;
      }

      try {
        const result = await nativeArtifacts.ensureNative({
          provider,
          providerSessionId,
          projectPath,
          messages: Array.isArray(message.messages) ? message.messages : [],
        });
        dependencies.send({
          type: 'session.native_ready',
          requestId,
          sessionId: message.sessionId,
          success: result.success,
          jsonlPath: result.jsonlPath,
          restored: result.restored,
          dropProviderSessionId: result.dropProviderSessionId,
          error: result.error,
        });
      } catch (error) {
        dependencies.send({
          type: 'session.native_ready',
          requestId,
          sessionId: message.sessionId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

export type WorkerChatRunner = ReturnType<typeof createWorkerChatRunner>;
