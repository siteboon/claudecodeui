import { authenticatedFetch } from '../utils/api';
import { voiceConfigHeaders } from '../hooks/useVoiceConfig';

// A single app-level audio player for read-aloud. It owns one <audio> element, lives
// outside the React tree, and caches generated audio by content. Because playback is not
// tied to a component, switching chats or re-rendering a message can't revoke the blob URL
// out from under it (the cause of mid-play cutoffs). v1 plays one message at a time
// (a new play replaces the current one); the design leaves room for a queue later.

export type VoicePlayState = 'idle' | 'loading' | 'playing';

export type VoiceSnapshot = { state: VoicePlayState; error: string | null };

const IDLE: VoiceSnapshot = { state: 'idle', error: null };
const CACHE_MAX = 24;
const CLIENT_TIMEOUT_MS = 330000; // backstop; the server proxy already times out at 5 min

// Stable id / cache key from a message's text (djb2).
export function voiceId(content: string): string {
  let h = 5381;
  for (let i = 0; i < content.length; i++) h = (((h << 5) + h) + content.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private unlocked = false;
  private cache = new Map<string, string>(); // id -> blob URL (insertion order = LRU)
  private currentId: string | null = null;
  private state: VoicePlayState = 'idle';
  private errorId: string | null = null;
  private errorMsg: string | null = null;
  private token = 0; // bumps to cancel in-flight fetches
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  getSnapshot(id: string): VoiceSnapshot {
    const state = this.currentId === id ? this.state : 'idle';
    const error = this.errorId === id ? this.errorMsg : null;
    if (state === 'idle' && error === null) return IDLE;
    return { state, error };
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      const audio = new Audio();
      audio.addEventListener('ended', () => this.onEnded());
      audio.addEventListener('error', () => {
        // Only meaningful while we believe we're playing.
        if (this.state === 'playing') this.onEnded();
      });
      this.audio = audio;
    }
    return this.audio;
  }

  // Call synchronously from the click handler so iOS grants the (reused) element playback.
  unlock() {
    if (this.unlocked) return;
    const audio = this.ensureAudio();
    try {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      audio.pause();
    } catch {
      /* priming attempt; ignore */
    }
    this.unlocked = true;
  }

  toggle(content: string) {
    const id = voiceId(content);
    if (this.currentId === id && (this.state === 'playing' || this.state === 'loading')) {
      this.stop();
      return;
    }
    void this.play(id, content);
  }

  stop() {
    this.token++; // cancel any in-flight fetch
    if (this.audio) this.audio.pause();
    this.state = 'idle';
    this.currentId = null;
    this.emit();
  }

  private onEnded() {
    this.state = 'idle';
    this.currentId = null;
    this.emit();
    // (queue auto-advance would hook in here)
  }

  private setError(id: string, msg: string) {
    this.state = 'idle';
    this.currentId = id;
    this.errorId = id;
    this.errorMsg = msg;
    this.emit();
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      if (this.errorId === id) {
        this.errorId = null;
        this.errorMsg = null;
        if (this.currentId === id) this.currentId = null;
        this.emit();
      }
    }, 6000);
  }

  private async play(id: string, content: string) {
    const audio = this.ensureAudio();
    audio.pause();
    this.currentId = id;
    this.errorId = null;
    this.errorMsg = null;
    this.state = 'loading';
    this.emit();

    const myToken = ++this.token;

    try {
      let url = this.cache.get(id);
      if (!url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
        const res = await authenticatedFetch('/api/voice/tts', {
          method: 'POST',
          body: JSON.stringify({ text: content }),
          headers: voiceConfigHeaders(),
          signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        if (myToken !== this.token) return; // superseded by another play/stop
        if (!res.ok) {
          let msg = `Read-aloud failed (${res.status})`;
          try {
            const j = await res.json();
            if (j?.error) msg = String(j.error);
          } catch {
            /* non-JSON error body */
          }
          throw new Error(msg);
        }
        const blob = await res.blob();
        if (myToken !== this.token) return;
        url = URL.createObjectURL(blob);
        this.cacheSet(id, url);
      }
      if (myToken !== this.token) return;
      audio.src = url;
      audio.load();
      await audio.play();
      if (myToken !== this.token) return;
      this.state = 'playing';
      this.emit();
    } catch (e) {
      if (myToken !== this.token) return;
      const aborted = e instanceof Error && e.name === 'AbortError';
      this.setError(id, aborted ? 'Read-aloud timed out.' : e instanceof Error ? e.message : 'Read-aloud failed');
    }
  }

  private cacheSet(id: string, url: string) {
    this.cache.set(id, url);
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const oldUrl = this.cache.get(oldest);
      this.cache.delete(oldest);
      if (oldUrl && oldUrl !== this.audio?.src) URL.revokeObjectURL(oldUrl);
    }
  }
}

export const voicePlayer = new VoicePlayer();
