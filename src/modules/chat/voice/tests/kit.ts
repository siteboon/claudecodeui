import { vi } from 'vitest';

/**
 * Shared fakes for the voice overlay's tests. Browser media APIs are not in
 * jsdom, so the tests install small, explicit fakes and assert on what the code
 * asked of them.
 */

// jsdom has no media playback; quiet no-ops underneath the per-test spies, so a
// stop() after the spies are restored does not log "Not implemented".
HTMLMediaElement.prototype.pause = function pause() {};
HTMLMediaElement.prototype.load = function load() {};
HTMLMediaElement.prototype.play = function play() {
  return Promise.resolve();
};

export type MediaCalls = { play: number; pause: number; srcs: string[] };

/** `<audio>` fakes. `playResult` decides what `play()` does on the NEXT calls. */
export function installAudioFakes(): MediaCalls & { refuseNextPlay: (name?: string) => void } {
  const calls: MediaCalls = { play: 0, pause: 0, srcs: [] };
  let refusal: string | null = null;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play(this: HTMLMediaElement) {
    calls.play += 1;
    calls.srcs.push(this.src);
    if (refusal) {
      const name = refusal;
      refusal = null;
      const error = new Error('play() refused');
      error.name = name;
      return Promise.reject(error);
    }
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    calls.pause += 1;
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
  let n = 0;
  if (!('createObjectURL' in URL)) {
    Object.assign(URL, { createObjectURL: () => '', revokeObjectURL: () => undefined });
  }
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:voice-${(n += 1)}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  return Object.assign(calls, { refuseNextPlay: (name = 'NotAllowedError') => { refusal = name; } });
}

/** A Response-shaped object good enough for the voice code paths. */
export function fakeResponse(status: number, body: unknown, blob?: Blob) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    text: async () => text,
    blob: async () => blob ?? new Blob(['mp3'], { type: 'audio/mpeg' }),
  } as unknown as Response;
}

/** Minimal MediaRecorder + getUserMedia fakes, recording one 1 kB chunk. */
export function installRecorderFakes(options: { bytes?: number } = {}) {
  const bytes = options.bytes ?? 1024;
  const instances: FakeRecorder[] = [];
  class FakeRecorder {
    static isTypeSupported = (type: string) => type === 'audio/webm';
    state: 'inactive' | 'recording' = 'inactive';
    mimeType = 'audio/webm';
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    constructor() {
      instances.push(this);
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }) });
      void this.onstop?.();
    }
  }
  const trackStop = vi.fn();
  const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: trackStop }] }));
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  return { instances, getUserMedia, trackStop };
}

/** Sets the stored UI preferences the voice code reads synchronously. */
export async function setUiPreferences(values: Record<string, boolean>) {
  const { writeUserPreference } = await import('@/shared/userSettings');
  writeUserPreference('uiPreferences', values);
}
