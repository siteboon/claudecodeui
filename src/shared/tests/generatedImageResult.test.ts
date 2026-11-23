import { describe, expect, it } from 'vitest';

import { readGeneratedImageResult } from '@/shared/utils';

const ASSET_ID = '12345678-1234-4234-8234-123456789abc';
const ASSET_PATH = 'generated-images/' + ASSET_ID + '.png';
const JOB = {
  kind: 'cloudcli.image_generation', version: 1, jobId: 'a'.repeat(64), status: 'succeeded',
  promptPreview: 'A blue 日本語 image',
  asset: { id: ASSET_ID, path: ASSET_PATH, mimeType: 'image/png', bytes: 69, sha256: 'b'.repeat(64) },
};

describe('generated image tool-result contract', () => {
  it.each([
    () => JOB,
    () => ({ structuredContent: JOB }),
    () => ({ content: [{ type: 'text', text: JSON.stringify(JOB) }] }),
    () => ({ content: JSON.stringify([{ type: 'text', text: JSON.stringify(JOB) }]) }),
    () => ({ content: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(JOB) }], structuredContent: JOB }) }),
  ])('recognizes direct, Claude-style and Codex-style envelopes', (makeEnvelope) => {
    expect(readGeneratedImageResult(makeEnvelope())?.assetPath).toBe(ASSET_PATH);
  });

  it.each(['../../secret.png', '/etc/secret.png', 'https://example.com/image.png', 'generated-images/' + ASSET_ID + '.svg', 'generated-images/subdir/' + ASSET_ID + '.png'])('refuses arbitrary image sources: %s', (path) => {
    const job = structuredClone(JOB);
    job.asset.path = path;
    expect(readGeneratedImageResult(job)).toBeNull();
  });

  it('rejects mismatched identifiers, unsupported versions, oversized text and cyclic objects', () => {
    const job = structuredClone(JOB);
    job.asset.id = 'other-id';
    expect(readGeneratedImageResult(job)).toBeNull();
    expect(readGeneratedImageResult({ ...JOB, version: 2 })).toBeNull();
    expect(readGeneratedImageResult(' '.repeat(130 * 1024))).toBeNull();
    const cyclic: { content?: unknown } = {};
    cyclic.content = cyclic;
    expect(readGeneratedImageResult(cyclic)).toBeNull();
  });
});
