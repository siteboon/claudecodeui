import { createHash } from 'node:crypto';

import type { ImageGenerationInput, ImageGenerationProvider } from '@/shared/index.js';
import { ImageGenerationError } from '@/modules/image-generation/image-generation.error.js';

/** Used by the optional MCP command to call a configured, base64-returning Images API. */
export class OpenAICompatibleImageProvider implements ImageGenerationProvider {
  readonly identity: string;
  private readonly endpoint: URL;
  private readonly timeoutMs: number;
  private readonly maxImageBytes: number;

  constructor(private readonly options: {
    endpoint: string;
    model: string;
    apiKey: string;
    authMode?: 'bearer' | 'api-key';
    timeoutMs?: number;
    maxImageBytes?: number;
    fetch?: typeof fetch;
  }) {
    try { this.endpoint = new URL(options.endpoint); } catch {
      throw new ImageGenerationError('INVALID_CONFIG', 'The image endpoint must be an absolute HTTP(S) URL.');
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(this.endpoint.hostname);
    if (this.endpoint.username || this.endpoint.password || this.endpoint.hash
      || (this.endpoint.protocol !== 'https:' && !(this.endpoint.protocol === 'http:' && loopback))) {
      throw new ImageGenerationError('INVALID_CONFIG', 'Use HTTPS for the image endpoint (HTTP is allowed only on loopback).');
    }
    if (Array.from(this.endpoint.searchParams.keys()).some((key) => /key|token|secret|authorization/i.test(key))) {
      throw new ImageGenerationError('INVALID_CONFIG', 'Pass image credentials in the API-key environment setting, not the endpoint URL.');
    }
    if (!options.model.trim() || !options.apiKey.trim() || /[\r\n]/.test(options.apiKey)) {
      throw new ImageGenerationError('INVALID_CONFIG', 'Configure both an image model and a valid API key.');
    }
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxImageBytes = options.maxImageBytes ?? 20 * 1024 * 1024;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 300_000
      || !Number.isInteger(this.maxImageBytes) || this.maxImageBytes < 1 || this.maxImageBytes > 64 * 1024 * 1024) {
      throw new ImageGenerationError('INVALID_CONFIG', 'Invalid image timeout or response-size limit.');
    }
    this.identity = createHash('sha256').update(this.endpoint.href + '\0' + options.model).digest('hex');
  }

  async generate(input: ImageGenerationInput, signal?: AbortSignal): Promise<Uint8Array> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.authMode === 'api-key') headers['api-key'] = this.options.apiKey;
    else headers.Authorization = 'Bearer ' + this.options.apiKey;

    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(this.endpoint, {
        method: 'POST', headers, redirect: 'error',
        body: JSON.stringify({
          model: this.options.model, prompt: input.prompt, n: 1, output_format: 'png',
          ...(input.size === undefined ? {} : { size: input.size }),
          ...(input.quality === undefined ? {} : { quality: input.quality }),
        }),
        signal: AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(signal ? [signal] : [])]),
      });
    } catch {
      // The provider may already have accepted/billed the request. Never retry it here.
      throw new ImageGenerationError('PROVIDER_UNCERTAIN', 'The provider response is uncertain. Check this saved job before requesting another generation.', 'uncertain');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const rejected = response.status >= 400 && response.status < 500;
      throw new ImageGenerationError(
        'PROVIDER_HTTP_' + response.status,
        'The image provider returned HTTP ' + response.status + '. Inspect the saved job before intentionally starting a new request.',
        rejected ? 'rejected' : 'uncertain',
      );
    }

    try {
      const maxResponseBytes = Math.ceil(this.maxImageBytes * 4 / 3) + 64 * 1024;
      if (Number(response.headers.get('content-length')) > maxResponseBytes || !response.body) throw new Error('size');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > maxResponseBytes) throw new Error('size');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const data = body && typeof body === 'object' && 'data' in body ? body.data : undefined;
      if (!Array.isArray(data) || data.length !== 1) throw new Error('shape');
      const encoded: unknown = data[0]?.b64_json;
      if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length % 4 !== 0
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('base64');
      const image = Buffer.from(encoded, 'base64');
      if (image.length === 0 || image.length > this.maxImageBytes || image.toString('base64') !== encoded) throw new Error('size');
      return image;
    } catch {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageGenerationError('PROVIDER_INVALID_RESPONSE', 'The provider returned an unreadable or oversized image result. This job will not be generated again automatically.', 'uncertain');
    }
  }
}
