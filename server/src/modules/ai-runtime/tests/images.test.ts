import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppError } from '@/shared/utils/app-error.js';
import { llmAssetsService } from '@/modules/assets/assets.service.js';
import { ClaudeProvider } from '@/modules/ai-runtime/providers/claude/claude.provider.js';
import { CodexProvider } from '@/modules/ai-runtime/providers/codex/codex.provider.js';
import { CursorProvider } from '@/modules/ai-runtime/providers/cursor/cursor.provider.js';
import { GeminiProvider } from '@/modules/ai-runtime/providers/gemini/gemini.provider.js';
import { llmService } from '@/modules/ai-runtime/services/ai-runtime.service.js';

const asyncEvents = async function* (events: unknown[]) {
  for (const event of events) {
    yield event;
  }
};

/**
 * This test covers the universal image-upload flow: store uploads under `.cloudcli/assets`.
 */
test('llmAssetsService stores uploaded images in .cloudcli/assets', { concurrency: false }, async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-assets-'));
  try {
    const images = await llmAssetsService.storeUploadedImages(
      [
        {
          originalname: 'photo.jpg',
          mimetype: 'image/jpeg',
          size: 3,
          buffer: Buffer.from([0x01, 0x02, 0x03]),
        },
        {
          originalname: 'diagram.png',
          mimetype: 'image/png',
          size: 4,
          buffer: Buffer.from([0x11, 0x12, 0x13, 0x14]),
        },
      ],
      { workspacePath: workspaceRoot },
    );

    assert.equal(images.length, 2);
    assert.ok(images[0]?.relativePath.startsWith('.cloudcli/assets/'));
    assert.ok(images[1]?.relativePath.startsWith('.cloudcli/assets/'));
    await fs.access(images[0]!.absolutePath);
    await fs.access(images[1]!.absolutePath);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers upload validation: unsupported mime types are rejected.
 */
test('llmAssetsService rejects unsupported image mime types', async () => {
  await assert.rejects(
    llmAssetsService.storeUploadedImages([
      {
        originalname: 'file.bmp',
        mimetype: 'image/bmp',
        size: 4,
        buffer: Buffer.from([0x10, 0x20, 0x30, 0x40]),
      },
    ]),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'UNSUPPORTED_IMAGE_TYPE' &&
      error.statusCode === 400,
  );
});

/**
 * This test covers Claude image input support: prompt becomes async iterable with text + base64 image blocks.
 */
test('claude provider builds async prompt payload with base64 image blocks', { concurrency: false }, async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-claude-img-'));
  const imagePath = path.join(workspaceRoot, 'sample.jpg');
  const imageBytes = Buffer.from([0xaa, 0xbb, 0xcc]);
  await fs.writeFile(imagePath, imageBytes);

  try {
    const provider = new ClaudeProvider() as any;
    const promptPayload = await provider.buildPromptInput(
      'describe this',
      [imagePath],
      workspaceRoot,
    );

    assert.equal(typeof promptPayload[Symbol.asyncIterator], 'function');
    const iterator = promptPayload[Symbol.asyncIterator]();
    const first = await iterator.next();
    assert.equal(first.done, false);

    const message = first.value as {
      type: string;
      message: {
        role: string;
        content: Array<Record<string, unknown>>;
      };
    };

    assert.equal(message.type, 'user');
    assert.equal(message.message.role, 'user');
    assert.equal(message.message.content[0]?.type, 'text');
    assert.equal(message.message.content[0]?.text, 'describe this');
    assert.equal(message.message.content[1]?.type, 'image');
    const imageBlock = message.message.content[1] as {
      source: {
        type: string;
        media_type: string;
        data: string;
      };
    };
    assert.equal(imageBlock.source.type, 'base64');
    assert.equal(imageBlock.source.media_type, 'image/jpeg');
    assert.equal(imageBlock.source.data, imageBytes.toString('base64'));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

/**
 * This test covers Codex image input support: runStreamed receives text + local_image items.
 */
test('codex provider sends local_image prompt items when image paths are provided', async () => {
  const provider = new CodexProvider() as any;
  let capturedPrompt: unknown;

  provider.loadCodexSdkModule = async () => ({
    Codex: class {
      startThread() {
        return {
          async runStreamed(prompt: unknown) {
            capturedPrompt = prompt;
            return { events: asyncEvents([]) };
          },
        };
      }

      resumeThread() {
        return {
          async runStreamed(prompt: unknown) {
            capturedPrompt = prompt;
            return { events: asyncEvents([]) };
          },
        };
      }
    },
  });

  await provider.createSdkExecution({
    prompt: 'analyze this image',
    sessionId: 'codex-image-1',
    isResume: false,
    imagePaths: ['assets/a.png'],
    workspacePath: '/tmp/workspace',
  });

  assert.ok(Array.isArray(capturedPrompt));
  const promptItems = capturedPrompt as Array<Record<string, unknown>>;
  assert.equal(promptItems[0]?.type, 'text');
  assert.equal(promptItems[0]?.text, 'analyze this image');
  assert.equal(promptItems[1]?.type, 'local_image');
  assert.equal(promptItems[1]?.path, path.resolve('/tmp/workspace', 'assets/a.png'));
});

/**
 * This test covers Gemini/Cursor image handling: image paths are appended to the prompt payload.
 */
test('gemini and cursor providers append image path arrays to prompts', () => {
  const geminiProvider = new GeminiProvider() as any;
  const cursorProvider = new CursorProvider() as any;

  const geminiInvocation = geminiProvider.createCliInvocation({
    prompt: 'summarize',
    sessionId: 'g-1',
    isResume: false,
    imagePaths: ['scripts/pic.jpg'],
  });

  const cursorInvocation = cursorProvider.createCliInvocation({
    prompt: 'summarize',
    sessionId: 'c-1',
    isResume: false,
    imagePaths: ['scripts/pic.jpg'],
  });

  const geminiPrompt = geminiInvocation.args[1];
  const cursorPrompt = cursorInvocation.args[cursorInvocation.args.length - 1];
  assert.ok(typeof geminiPrompt === 'string' && geminiPrompt.includes('["scripts/pic.jpg"]'));
  assert.ok(typeof cursorPrompt === 'string' && cursorPrompt.includes('["scripts/pic.jpg"]'));
});

/**
 * This test covers API payload validation: imagePaths must be an array of strings.
 */
test('llmService rejects invalid imagePaths payloads before provider execution', async () => {
  await assert.rejects(
    llmService.startSession('cursor', {
      prompt: 'hello',
      imagePaths: [1, 2, 3],
    }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_IMAGE_PATHS' &&
      error.statusCode === 400,
  );
});
