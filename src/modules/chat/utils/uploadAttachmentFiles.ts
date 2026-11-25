import { api, readApiErrorMessage } from '@/shared/api';

/** Used by the chat composer to upload files with a correlation ID and readable failures. */
export async function uploadAttachmentFiles(files: File[], requestId: string): Promise<unknown[]> {
  if (files.length === 0) return [];

  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  const failure = (message: string, phase: string, status?: number, reference = requestId) => {
    // Do not log filenames, file data, auth headers or raw fetch/parser errors.
    console.warn({ event: 'attachment_upload_failed', requestId: reference, phase, status });
    return new Error(`${message} Reference: ${reference}`);
  };

  let response: Response;
  try {
    response = await api.assets.uploadFiles(formData, requestId);
  } catch {
    throw failure('Upload connection failed. Check your connection and try again.', 'network');
  }

  const headerId = response.headers.get('X-Upload-Request-ID');
  const reference = headerId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(headerId)
    ? headerId : requestId;
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw failure(readApiErrorMessage(body) ?? `Upload failed (HTTP ${response.status}).`,
      'http', response.status, reference);
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw failure('The upload response was interrupted or invalid. Please try attaching the files again.',
      'response', response.status, reference);
  }
  if (!result || typeof result !== 'object' || !('attachments' in result)
    || !Array.isArray(result.attachments) || result.attachments.length !== files.length) {
    throw failure('File upload returned an incomplete result. Please try attaching the files again.',
      'metadata', response.status, reference);
  }
  return result.attachments;
}
