const AUDIO_PREF_KEY = 'pref:audio:enabled';
const AUDIO_COMPLETE_PREF_KEY = 'pref:audio:complete:enabled';

export function isAudioEnabled(): boolean {
  try {
    return localStorage.getItem(AUDIO_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAudioEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUDIO_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export function isAudioCompleteEnabled(): boolean {
  try {
    return localStorage.getItem(AUDIO_COMPLETE_PREF_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAudioCompleteEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUDIO_COMPLETE_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

function playTones(freqs: number[], volume = 0.22): void {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx() as AudioContext;
    const now = ctx.currentTime;

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      osc.start(start);
      osc.stop(start + 0.3);
    });

    setTimeout(() => ctx.close(), 1200);
  } catch {
    // Audio API blocked or unavailable
  }
}

// Ascending chime (660→880Hz) — used when user action is needed
export function playActionRequiredSound(): void {
  if (!isAudioEnabled()) return;
  playTones([660, 880]);
}

// Descending chime (880→660Hz) — used when Claude finishes a response
export function playCompletedSound(): void {
  if (!isAudioCompleteEnabled()) return;
  playTones([880, 660]);
}
