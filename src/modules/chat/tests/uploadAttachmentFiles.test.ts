import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadAttachmentFiles } from '@/modules/chat/utils/uploadAttachmentFiles';

const REQUEST_ID = '12345678-1234-4234-8234-123456789abc';
const SERVER_ID = 'abcdefab-1234-4234-8234-123456789abc';
const files = () => [new File(['synthetic contents'], 'example.txt', { type: 'text/plain' })];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'X-Upload-Request-ID': SERVER_ID },
});

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('chat attachment upload failures', () => {
  it('does not make a request for an empty selection', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await uploadAttachmentFiles([], REQUEST_ID)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends multipart data and the request ID without setting a content type', async () => {
    const attachments = [{ name: 'example.txt', path: '/synthetic/example.txt' }];
    const fetch = vi.fn().mockResolvedValue(json({ attachments }));
    vi.stubGlobal('fetch', fetch);
    expect(await uploadAttachmentFiles(files(), REQUEST_ID)).toEqual(attachments);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/assets/files');
    expect(options.headers['X-Upload-Request-ID']).toBe(REQUEST_ID);
    expect(options.headers['Content-Type']).toBeUndefined();
    expect(options.body.getAll('files')).toHaveLength(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('reports a network failure with the client ID and does not retry the POST', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('private raw network details'));
    vi.stubGlobal('fetch', fetch);
    await expect(uploadAttachmentFiles(files(), REQUEST_ID)).rejects.toThrow(`Upload connection failed. Check your connection and try again. Reference: ${REQUEST_ID}`);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith({
      event: 'attachment_upload_failed', requestId: REQUEST_ID, phase: 'network', status: undefined,
    });
  });

  it.each([
    { error: 'Each file must be 10 MB or smaller.' },
    { error: { code: 'LIMIT_FILE_SIZE', message: 'Each file must be 10 MB or smaller.' } },
  ])('preserves a readable HTTP error and the server correlation ID', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body, 413)));
    await expect(uploadAttachmentFiles(files(), REQUEST_ID)).rejects.toThrow(`Each file must be 10 MB or smaller. Reference: ${SERVER_ID}`);
    expect(console.warn).toHaveBeenCalledWith({
      event: 'attachment_upload_failed', requestId: SERVER_ID, phase: 'http', status: 413,
    });
  });

  it('keeps the HTTP status when a proxy returns HTML instead of JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<h1>Gateway timeout</h1>', { status: 504 })));
    await expect(uploadAttachmentFiles(files(), REQUEST_ID)).rejects.toThrow(`Upload failed (HTTP 504). Reference: ${REQUEST_ID}`);
  });

  it('does not display an arbitrary response header as a correlation ID', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      status: 500, headers: { 'X-Upload-Request-ID': 'not-a-request-id' },
    })));
    await expect(uploadAttachmentFiles(files(), REQUEST_ID)).rejects.toThrow(`Reference: ${REQUEST_ID}`);
  });

  it('distinguishes an unreadable response from an HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', { status: 200 })));
    await expect(uploadAttachmentFiles(files(), REQUEST_ID)).rejects.toThrow('upload response was interrupted or invalid');
    expect(console.warn).toHaveBeenCalledWith(expect.objectContaining({ phase: 'response', status: 200 }));
  });

  it.each([null, {}, { attachments: [] }, { attachments: {} }])('rejects missing attachment metadata without a parser exception', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(body)));
    await expect(uploadAttachmentFiles(files(), REQUEST_ID)).rejects.toThrow('File upload returned an incomplete result');
    expect(console.warn).toHaveBeenCalledWith(expect.objectContaining({ phase: 'metadata', status: 200 }));
  });
});
