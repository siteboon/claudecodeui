import assert from 'node:assert/strict';

import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * The completion chime played at a fixed .075/.06 gain (about -22.6 dBFS),
 * which users found too quiet, with no way to change it (#1548). It now plays
 * at the volume saved in Settings, mirrored into localStorage, through a
 * squared taper whose 100% stops short of clipping.
 *
 * jsdom has no Web Audio, so a recording AudioContext stands in for it. The
 * sound helpers pick the constructor and cache the context when they load,
 * which is why every test imports a fresh copy after installing the fake.
 */

type ScheduledTone = { frequency: number; peakGain: number };

let tones: ScheduledTone[] = [];

class RecordingAudioContext {
  state = 'running';
  currentTime = 0;
  destination = {};

  createOscillator() {
    const tone: ScheduledTone = { frequency: 0, peakGain: 0 };
    tones.push(tone);
    return {
      type: 'sine',
      frequency: { setValueAtTime: (value: number) => { tone.frequency = value; } },
      connect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    };
  }

  createGain() {
    // The chime ramps up to its peak first, then down to silence.
    const tone = tones[tones.length - 1];
    let ramps = 0;
    return {
      gain: {
        setValueAtTime: () => undefined,
        exponentialRampToValueAtTime: (value: number) => {
          ramps += 1;
          if (ramps === 1) {
            tone.peakGain = value;
          }
        },
      },
      connect: () => undefined,
    };
  }

  resume() {
    return Promise.resolve();
  }
}

const loadSoundHelpers = async () => {
  vi.resetModules();
  return import('@/shared/utils');
};

const playAndRecord = async (options?: { force?: boolean }) => {
  const { playNotificationSound } = await loadSoundHelpers();
  await playNotificationSound(options);
  return tones.map((tone) => [tone.frequency, Number(tone.peakGain.toFixed(4))]);
};

beforeEach(() => {
  tones = [];
  localStorage.clear();
  vi.stubGlobal('AudioContext', RecordingAudioContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('without a saved volume the chime plays at the 70% default, about -12 dBFS', async () => {
  // 0.5 * 0.7^2 = 0.245 for the first note; the second keeps the 4:5 balance.
  assert.deepEqual(await playAndRecord(), [[740, 0.245], [988, 0.196]]);
});

test('the chime follows the saved volume', async () => {
  localStorage.setItem('notificationSoundVolume', '100');
  assert.deepEqual(await playAndRecord(), [[740, 0.5], [988, 0.4]]);

  tones = [];
  localStorage.setItem('notificationSoundVolume', '40');
  assert.deepEqual(await playAndRecord(), [[740, 0.08], [988, 0.064]]);
});

test('at full volume the two notes together stay below clipping', async () => {
  localStorage.setItem('notificationSoundVolume', '100');
  const peaks = (await playAndRecord()).map(([, peak]) => peak);
  assert.ok(peaks.reduce((sum, peak) => sum + peak, 0) <= 1, `sum of note peaks ${peaks.join(' + ')}`);
});

test('a volume of 0 plays nothing, even for the settings preview', async () => {
  localStorage.setItem('notificationSoundVolume', '0');
  assert.deepEqual(await playAndRecord({ force: true }), []);
});

test('an unreadable or out-of-range saved volume falls back or is clamped', async () => {
  localStorage.setItem('notificationSoundVolume', 'loud');
  assert.deepEqual(await playAndRecord(), [[740, 0.245], [988, 0.196]]);

  tones = [];
  localStorage.setItem('notificationSoundVolume', '250');
  assert.deepEqual(await playAndRecord(), [[740, 0.5], [988, 0.4]]);
});

test('setNotificationSoundVolume is what the chime reads', async () => {
  const { setNotificationSoundVolume } = await loadSoundHelpers();
  setNotificationSoundVolume(50);
  assert.deepEqual(await playAndRecord(), [[740, 0.125], [988, 0.1]]);
});

test('turning the sound off still silences the chime at any volume', async () => {
  localStorage.setItem('notificationSoundEnabled', 'false');
  localStorage.setItem('notificationSoundVolume', '100');
  assert.deepEqual(await playAndRecord(), []);
});
