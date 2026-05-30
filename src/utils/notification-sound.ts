const STORAGE_KEY = 'notificationSoundEnabled';

/**
 * Returns whether the notification sound is enabled.
 */
export function isNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === null || value === 'true';
  } catch {
    return true;
  }
}

/**
 * Persists the notification sound preference to localStorage.
 */
export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Restricted storage context
  }
}

/**
 * Plays a two-tone completion sound using the Web Audio API.
 */
export function playCompletionSound(): void {
  if (typeof window === 'undefined') return;
  try {
    const ctx = new AudioContext();
    const playTone = (frequency: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.3, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    const now = ctx.currentTime;
    playTone(880, now, 0.12);
    playTone(1100, now + 0.15, 0.2);
    setTimeout(() => ctx.close(), 600);
    console.log('[notification-sound] playing completion sound');
  } catch (err) {
    console.error('[notification-sound] failed to play:', err);
  }
}
