import { playNotificationSound } from '@/shared/utils';

/**
 * The one sound an ear-only builder hears when an own turn fails on the server
 * side (OQ2): a fixed Czech phrase, "Běh selhal", generated ONCE from that
 * fixed text and shipped as a static file. No vendor call at runtime, no client
 * data in it.
 *
 * The file is served from `public/`, so a build without it still works: until
 * the asset is generated and committed, the cue falls back to the local
 * notification chime.
 */
export const FAILURE_CUE_PATH = 'kryton-voice/beh-selhal.mp3';

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
