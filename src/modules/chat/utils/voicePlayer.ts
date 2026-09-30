import { synthesizeVoice, voiceConfigSignature } from '@/shared/api';
import type { VoicePlayState, VoiceSnapshot } from '@/shared/types';
import { voiceErrorFromException, voiceErrorFromResponse, VoiceRequestError } from '@/modules/chat/voice/voiceErrors';

// A single app-level audio player for read-aloud. It owns one <audio> element, lives
// outside the React tree, and caches generated audio by content. Because playback is not
// tied to a component, switching chats or re-rendering a message can't revoke the blob URL
// out from under it (the cause of mid-play cutoffs). v1 plays one message at a time
// (a new play replaces the current one); the design leaves room for a queue later.


const IDLE: VoiceSnapshot = { state: 'idle', error: null };
const CACHE_MAX = 24;
// Backstop above the relay's VOICE_TIMEOUT_MS (the voice service's longest limit + 5 s),
// so the service's own limit is the one that fires and reports a code.
const CLIENT_TIMEOUT_MS = 75000;

// Stable id / cache key from the text and voice settings that affect its audio (djb2).
export function voiceId(content: string, signature = voiceConfigSignature()): string {
  const input = JSON.stringify([content, signature]);
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (((h << 5) + h) + input.charCodeAt(i)) | 0;
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
  private token = 0; // bumps to ignore stale in-flight results
  private activeController: AbortController | null = null; // aborts the in-flight TTS fetch
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  // The browser refused play() for this id; its audio stays cached for a replay.
  private blockedId: string | null = null;
  // The current play was started by auto-speak (and may be abandoned when it is switched off).
  private autoId: string | null = null;

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

  /** Auto-speak: play `text` unless `guard` says no - checked again right where the request is made. */
  speak(text: string, guard: () => boolean): string {
    const id = voiceId(text);
    if (guard()) void this.play(id, text, guard);
    return id;
  }

  /** Replays already-fetched audio without a second request; false when nothing is cached. */
  replay(id: string): boolean {
    if (!this.cache.has(id)) return false;
    void this.play(id, '');
    return true;
  }

  /** Stops playback only when it was started by auto-speak. */
  stopAuto() {
    if (this.autoId && this.autoId === this.currentId) this.stop();
    this.autoId = null;
  }

  isBlocked(id: string): boolean {
    return this.blockedId === id;
  }

  current(): { id: string | null; state: VoicePlayState } {
    return { id: this.currentId, state: this.state };
  }

  stop() {
    this.token++; // ignore any stale in-flight result
    this.abortActive(); // and actually cancel the network request
    if (this.audio) this.audio.pause();
    this.state = 'idle';
    this.currentId = null;
    this.emit();
  }

  private abortActive() {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }
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

  private async play(id: string, content: string, guard?: () => boolean) {
    const audio = this.ensureAudio();
    if (this.blockedId === id) this.blockedId = null;
    this.autoId = guard ? id : null;
    audio.pause();
    this.currentId = id;
    this.errorId = null;
    this.errorMsg = null;
    this.state = 'loading';
    this.emit();

    const myToken = ++this.token;
    this.abortActive(); // cancel any request this play supersedes

    try {
      let url = this.cache.get(id);
      if (!url) {
        if (guard && !guard()) throw new DOMException('Auto-speak switched off', 'AbortError');
        const controller = new AbortController();
        this.activeController = controller;
        const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
        const res = await synthesizeVoice(content, controller.signal).finally(() => {
          clearTimeout(timer);
          if (this.activeController === controller) this.activeController = null;
        });
        if (myToken !== this.token) return; // superseded by another play/stop
        if (!res.ok) {
          // Only a code from the closed set leaves here - never the raw body.
          const body = await res.text().catch(() => '');
          throw new VoiceRequestError(voiceErrorFromResponse(res.status, body));
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
      if ((e as { name?: unknown } | null)?.name === 'NotAllowedError') {
        // The browser refused play() (no recent gesture): keep the cached blob for a replay.
        this.state = 'idle';
        this.currentId = null;
        this.blockedId = id;
        this.emit();
        return;
      }
      if (guard && !guard()) {
        this.state = 'idle';
        this.currentId = null;
        this.emit();
        return;
      }
      this.setError(id, voiceErrorFromException(e));
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
