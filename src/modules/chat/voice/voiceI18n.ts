import { i18n } from '@/modules/i18n';

import csVoice from '@/modules/chat/voice/locales/cs/voice.json';
import enVoice from '@/modules/chat/voice/locales/en/voice.json';

/**
 * The voice overlay's own `voice` namespace, registered from here rather than
 * from `modules/i18n/config.ts`: the overlay then needs no anchor in the file
 * the Czech overlay also patches, and removing either overlay cannot take the
 * other's strings with it. Every overlay component imports this module (or one
 * that does) before calling `useTranslation(VOICE_NS)`.
 */
export const VOICE_NS = 'voice';

const bundles: Record<string, unknown> = { en: enVoice, cs: csVoice };
for (const [lng, bundle] of Object.entries(bundles)) {
  if (!i18n.hasResourceBundle(lng, VOICE_NS)) {
    i18n.addResourceBundle(lng, VOICE_NS, bundle, true, false);
  }
}

export { i18n as voiceI18n };
