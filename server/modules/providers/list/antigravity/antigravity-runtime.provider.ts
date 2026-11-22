import { randomUUID } from 'node:crypto';

import crossSpawn from 'cross-spawn';

import {
  ANTIGRAVITY_DEFAULT_MODEL,
  resolveAntigravityModelId,
} from '@/modules/providers/list/antigravity/antigravity-models.provider.js';
import {
  appendFilesInputTag,
  appendImagesInputTag,
  getGlobalImageAssetsDir,
  normalizeAttachmentDescriptors,
} from '@/shared/image-attachments.js';
import {
  appendTranscriptMessages,
  writeTranscriptMeta,
} from '@/modules/providers/list/antigravity/antigravity-store.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type { NormalizedMessage, ProviderRuntimeContext, ProviderRuntimeWriter } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';

const PROVIDER = 'antigravity';

/**
 * Live execution adapter for Google's Antigravity CLI (`agy`).
 *
 * agy is a Go binary: it rejects Claude Code's SDK flags outright (`--resume`,
 * `--permission-mode`, `--include-partial-messages` are all "flags provided but
 * not defined"), so this adapter spawns it as a plain CLI and parses its own
 * NDJSON stream instead of reusing the Claude agent SDK:
 *
 *   agy -p <prompt> --output-format stream-json --model <id> --add-dir <cwd>
 *       [--conversation <id>] [--mode plan | --dangerously-skip-permissions]
 *
 * Its stream is three event shapes:
 *   {"event":"init",       "conversation_id": "...", "init": {...}}
 *   {"event":"step_update","step_update": { step_index, state, step_type, ... }}
 *   {"event":"result",     "result": { status, response, usage, ... }}
 *
 * `step_type` is one of `user_input`, `agent_response`, `tool`,
 * `system_message`. A step moves ACTIVE -> DONE and carries `text_delta` for
 * text steps and `tool_info` for tool steps. The stream is not pure JSON: agy
 * also writes plain log lines ("root agent idle; waiting for N background
 * task(s) to finish") to stdout, so every line is parsed defensively.
 */

type ActiveRun = {
  child: ReturnType<typeof crossSpawn>;
  aborted: boolean;
};

const activeRuns = new Map<string, ActiveRun>();

export function resolveAgyBinary(): string {
  return process.env.AGY_CLI_PATH?.trim()
    || process.env.ANTIGRAVITY_CLI_PATH?.trim()
    || 'agy';
}

/** agy's documented permission modes, mapped onto the app's composer values. */
function buildPermissionArgs(permissionMode: unknown, skipPermissions: unknown): string[] {
  const mode = typeof permissionMode === 'string' ? permissionMode : 'default';
  if (mode === 'plan') {
    // Read-only run: agy refuses edits and commands on its own, so the
    // blanket approval flag is deliberately NOT passed here.
    return ['--mode', 'plan'];
  }
  if (skipPermissions === true || mode === 'bypassPermissions' || mode === 'acceptEdits') {
    return ['--dangerously-skip-permissions'];
  }
  // Print mode has no one to answer a permission prompt; agy would auto-deny
  // every tool call and finish with nothing to say. Unattended runs therefore
  // use the same unrestricted profile agy-staff defaults to.
  return ['--dangerously-skip-permissions'];
}

type StepState = {
  index: number;
  stepType: string;
  text: string;
  toolName?: string;
  toolId?: string;
  toolInput?: unknown;
  toolOutput?: string;
  done: boolean;
};

export const antigravityRuntime: IProviderRuntime = {
  async run(
    command: string,
    options: Record<string, unknown>,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    const appSessionId = String(options.sessionId ?? '');
    const providerSessionId = context.resolveProviderSessionId(appSessionId);
    const cwd = String(options.projectPath ?? options.cwd ?? process.cwd());
    const requestedModel = typeof options.model === 'string' ? options.model : undefined;
    const family = (await context.resolveResumeModel(appSessionId, requestedModel))
      || requestedModel
      || ANTIGRAVITY_DEFAULT_MODEL;
    // The picker keeps the model family and the effort tier apart; agy wants
    // them in one id (`gemini-4-hydrogen-high`), so they are recombined here.
    const effort = typeof options.effort === 'string' ? options.effort : undefined;
    const model = resolveAntigravityModelId(family, effort);

    // agy has no attachment flag: it reads files with its own tools, so the
    // prompt carries their paths in the shared attachment block that every
    // provider history adapter knows how to strip back out. The upload store
    // lives outside the workspace, which is why it is added as a second
    // directory — agy's file tools are scoped by `--add-dir`.
    const images = normalizeAttachmentDescriptors(options.images);
    const files = normalizeAttachmentDescriptors(options.files);
    const prompt = appendFilesInputTag(
      appendImagesInputTag(command || '', images),
      files,
    );

    const args = [
      '-p', prompt,
      '--output-format', 'stream-json',
      '--model', model,
      // 0 waits for the turn to finish instead of truncating a long tool run.
      '--print-timeout', '0s',
      '--add-dir', cwd,
    ];
    if (images.length + files.length > 0) {
      args.push('--add-dir', getGlobalImageAssetsDir());
    }
    if (providerSessionId) {
      args.push('--conversation', providerSessionId);
    }
    args.push(...buildPermissionArgs(options.permissionMode, options.skipPermissions));

    const child = crossSpawn(resolveAgyBinary(), args, {
      cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const run: ActiveRun = { child, aborted: false };
    activeRuns.set(appSessionId, run);

    let conversationId = providerSessionId;
    let resultStatus: string | null = null;
    let stderr = '';
    let sawError = false;

    const steps = new Map<number, StepState>();
    const emittedText = new Set<number>();
    const persisted: NormalizedMessage[] = [];

    const userMessage = createNormalizedMessage({
      kind: 'text',
      role: 'user',
      content: command,
      sessionId: appSessionId,
      provider: PROVIDER,
    });

    const stepId = (index: number) => `${conversationId ?? appSessionId}:step:${index}`;

    const emit = (message: NormalizedMessage) => writer.send(message);

    const onInit = (event: Record<string, unknown>) => {
      const id = typeof event.conversation_id === 'string' ? event.conversation_id : '';
      if (!id) {
        return;
      }
      conversationId = id;
      if (id !== providerSessionId) {
        writer.setSessionId?.(id);
        emit(createNormalizedMessage({
          kind: 'session_created',
          sessionId: appSessionId,
          newSessionId: id,
          model,
          provider: PROVIDER,
        }));
      }
    };

    const onStepUpdate = (event: Record<string, unknown>) => {
      const update = (event.step_update ?? {}) as Record<string, unknown>;
      const index = Number(update.step_index ?? -1);
      if (!Number.isFinite(index) || index < 0) {
        return;
      }
      const stepType = String(update.step_type ?? '');
      const state = String(update.state ?? '');
      const existing = steps.get(index) ?? { index, stepType, text: '', done: false };
      existing.stepType = stepType || existing.stepType;

      if (stepType === 'agent_response') {
        const delta = typeof update.text_delta === 'string' ? update.text_delta : '';
        if (delta) {
          existing.text += delta;
          emit(createNormalizedMessage({
            kind: 'stream_delta',
            content: delta,
            sessionId: appSessionId,
            provider: PROVIDER,
          }));
        }
        if (state === 'DONE' && existing.text.trim() && !emittedText.has(index)) {
          emittedText.add(index);
          const final = createNormalizedMessage({
            id: stepId(index),
            kind: 'text',
            role: 'assistant',
            content: existing.text,
            model,
            sessionId: appSessionId,
            provider: PROVIDER,
          });
          emit(final);
          persisted.push(final);
          emit(createNormalizedMessage({ kind: 'stream_end', sessionId: appSessionId, provider: PROVIDER }));
        }
      } else if (stepType === 'tool') {
        const toolName = String(update.tool_name ?? existing.toolName ?? 'Tool');
        const info = (update.tool_info ?? {}) as Record<string, unknown>;
        const parameters = (info.parameters ?? existing.toolInput ?? {}) as Record<string, unknown>;
        const toolId = `${conversationId ?? appSessionId}:tool:${index}`;
        existing.toolName = toolName;
        existing.toolId = toolId;
        existing.toolInput = parameters;

        if (state === 'DONE') {
          existing.done = true;
          existing.toolOutput = typeof info.output === 'string' ? info.output : existing.toolOutput;
          const done = createNormalizedMessage({
            id: stepId(index),
            kind: 'tool_use',
            toolId,
            toolName,
            toolInput: parameters,
            status: 'completed',
            toolResult: { content: existing.toolOutput ?? '', isError: false },
            sessionId: appSessionId,
            provider: PROVIDER,
          });
          emit(done);
          persisted.push(done);
        } else {
          emit(createNormalizedMessage({
            id: stepId(index),
            kind: 'tool_use',
            toolId,
            toolName,
            toolInput: parameters,
            status: 'in_progress',
            sessionId: appSessionId,
            provider: PROVIDER,
          }));
        }
      } else if (stepType === 'system_message' && state === 'DONE') {
        emit(createNormalizedMessage({
          kind: 'status',
          status: 'system',
          summary: typeof update.text_delta === 'string' ? update.text_delta : undefined,
          sessionId: appSessionId,
          provider: PROVIDER,
        }));
      }

      steps.set(index, existing);
    };

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      // agy interleaves human-readable log lines with the NDJSON stream.
      if (!trimmed.startsWith('{')) {
        return;
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        return;
      }
      const event = String(parsed.event ?? '');
      if (event === 'init') {
        onInit(parsed);
      } else if (event === 'step_update') {
        onStepUpdate(parsed);
      } else if (event === 'result') {
        const result = (parsed.result ?? {}) as Record<string, unknown>;
        resultStatus = typeof result.status === 'string' ? result.status : null;
        if (typeof result.conversation_id === 'string' && result.conversation_id) {
          conversationId = result.conversation_id;
        }
      } else if (event === 'error') {
        sawError = true;
        emit(createNormalizedMessage({
          kind: 'error',
          content: String(parsed.message ?? parsed.error ?? 'agy reported an error'),
          sessionId: appSessionId,
          provider: PROVIDER,
        }));
      }
    };

    try {
      await new Promise<void>((resolve) => {
        let buffer = '';
        child.stdout?.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          let boundary = buffer.indexOf('\n');
          while (boundary >= 0) {
            handleLine(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 1);
            boundary = buffer.indexOf('\n');
          }
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
          if (stderr.length > 64_000) {
            stderr = stderr.slice(-32_000);
          }
        });
        child.on('error', (error: Error) => {
          sawError = true;
          emit(createNormalizedMessage({
            kind: 'error',
            content: `Failed to launch ${resolveAgyBinary()}: ${error.message}`,
            sessionId: appSessionId,
            provider: PROVIDER,
          }));
          resolve();
        });
        child.on('close', () => {
          if (buffer.trim()) {
            handleLine(buffer);
          }
          resolve();
        });
      });
    } finally {
      activeRuns.delete(appSessionId);

      const failed = sawError || (resultStatus !== null && resultStatus !== 'SUCCESS');
      if (failed && stderr.trim()) {
        emit(createNormalizedMessage({
          kind: 'error',
          content: stderr.trim().slice(-4000),
          sessionId: appSessionId,
          provider: PROVIDER,
        }));
      }

      const finalId = conversationId ?? appSessionId;
      if (conversationId) {
        try {
          await writeTranscriptMeta({
            sessionId: conversationId,
            projectPath: cwd,
            title: command.trim().split('\n')[0]?.slice(0, 120) || null,
            model,
            createdAt: new Date().toISOString(),
          });
          await appendTranscriptMessages(conversationId, [userMessage, ...persisted]);
        } catch {
          // A failed transcript write must not turn a finished run into an error.
        }
      }

      emit(createCompleteMessage({
        provider: PROVIDER,
        sessionId: appSessionId,
        actualSessionId: finalId,
        exitCode: failed ? 1 : 0,
        aborted: run.aborted,
      }));
    }

    return { conversationId };
  },

  abort(sessionId: string): boolean {
    const run = activeRuns.get(sessionId);
    if (!run) {
      return false;
    }
    run.aborted = true;
    run.child.kill();
    return true;
  },
};

/** Exposed for tests: current in-flight runs. */
export function listActiveAntigravityRuns(): string[] {
  return Array.from(activeRuns.keys());
}

/** Creates a message id the runtime and history reader agree on. */
export function antigravityMessageId(): string {
  return randomUUID();
}
