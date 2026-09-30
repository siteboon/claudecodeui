/**
 * One error contract for the three voice hops (browser → CloudCLI relay →
 * voice service). The service answers with a status the relay keeps and a body
 * carrying `{code}` from a closed set; the relay forwards that body as `error`.
 * The client maps each code to plain copy and never shows a status code, a
 * vendor message or a raw body.
 */

export const SERVICE_ERROR_CODES = [
  'cap_daily',
  'cap_rate',
  'cap_request',
  'cap_concurrency',
  'vendor_rate',
  'vendor_down',
  'timeout',
  'unknown_workspace',
] as const;

export type ServiceErrorCode = (typeof SERVICE_ERROR_CODES)[number];
/** Client-side classes on top of the service's own codes. */
export type VoiceErrorCode = ServiceErrorCode | 'network' | 'generic';

const KNOWN = new Set<string>(SERVICE_ERROR_CODES);

/** Finds the service's `code` in a body the relay may have wrapped once or twice. */
export function parseServiceErrorCode(body: string | null | undefined): ServiceErrorCode | null {
  const text = String(body || '');
  const quoted = /"code"\s*:\s*"([a-z_]+)"/.exec(text) || /\\"code\\"\s*:\s*\\"([a-z_]+)\\"/.exec(text);
  if (quoted && KNOWN.has(quoted[1])) return quoted[1] as ServiceErrorCode;
  return null;
}

/** Maps a failed voice response to an error code. */
export function voiceErrorFromResponse(status: number, body: string | null | undefined): VoiceErrorCode {
  const code = parseServiceErrorCode(body);
  if (code) return code;
  if (status === 504 || status === 408) return 'timeout';
  if (status === 429) return 'vendor_rate';
  if (status === 502 || status === 503) return 'vendor_down';
  return 'generic';
}

/** Maps a thrown fetch error to an error code. */
export function voiceErrorFromException(error: unknown): VoiceErrorCode {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  if (name === 'TypeError') return 'network';
  if (error instanceof VoiceRequestError) return error.code;
  return 'generic';
}

export class VoiceRequestError extends Error {
  readonly code: VoiceErrorCode;
  constructor(code: VoiceErrorCode) {
    super(code);
    this.name = 'VoiceRequestError';
    this.code = code;
  }
}

/** Translation key (namespace `voice`) for an error code. */
export const voiceErrorKey = (code: VoiceErrorCode | string): string =>
  KNOWN.has(code) || code === 'network' || code === 'generic' ? `errors.${code}` : 'errors.generic';

/** Classes of microphone failure the builder must be told apart. */
export type MicErrorClass = 'policyBlocked' | 'denied' | 'busy' | 'notFound' | 'generic';

type PolicyDocument = Document & {
  permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
  featurePolicy?: { allowsFeature?: (feature: string) => boolean };
};

/**
 * A permissions-policy block and a builder's own "Block" both surface as
 * `NotAllowedError`; the document's policy tells them apart.
 */
export function classifyMicError(error: unknown, doc: Document | undefined = globalThis.document): MicErrorClass {
  const name = error && typeof error === 'object' && 'name' in error ? String((error as { name?: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    const policy = (doc as PolicyDocument | undefined)?.permissionsPolicy ?? (doc as PolicyDocument | undefined)?.featurePolicy;
    try {
      if (policy?.allowsFeature && policy.allowsFeature('microphone') === false) return 'policyBlocked';
    } catch {
      /* the policy API is best effort */
    }
    return 'denied';
  }
  if (name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError') return 'busy';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'notFound';
  return 'generic';
}

export const micErrorKey = (kind: MicErrorClass): string =>
  kind === 'generic' ? 'errors.generic' : `dictation.${kind}`;
