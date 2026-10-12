import { playNotificationSound } from '@/shared/utils';

/**
 * The one sound an ear-only user hears when their own turn fails on the server
 * side after the reply was already being spoken. A deployment may ship a short
 * fixed recording at `public/voice/failure-cue.mp3` (no vendor call at runtime);
 * without it, the cue falls back to the local notification chime.
 */
export const FAILURE_CUE_PATH = 'voice/failure-cue.mp3';

const cueUrl = () => `${import.meta.env?.BASE_URL || '/'}${FAILURE_CUE_PATH}`;

let cueAudio: HTMLAudioElement | null = null;

export async function playFailureCue(): Promise<'cue' | 'chime'> {
  try {
    if (!cueAudio) cueAudio = new Audio(cueUrl());
    cueAudio.currentTime = 0;
    await cueAudio.play();
    return 'cue';
  } catch {
    cueAudio = null;
    await playNotificationSound({ force: true });
    return 'chime';
  }
}
