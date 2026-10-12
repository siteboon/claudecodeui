import { i18n } from '@/modules/i18n';
import csVoice from '@/modules/chat/voice/locales/cs/voice.json';
import enVoice from '@/modules/chat/voice/locales/en/voice.json';

/**
 * The voice module's own `voice` namespace, registered from here rather than
 * from `modules/i18n/config.ts`, so the module carries its strings with it.
 * Every voice component imports this module (or one that does) before calling
 * `useTranslation(VOICE_NS)`.
 */
export const VOICE_NS = 'voice';

const bundles: Record<string, unknown> = { en: enVoice, cs: csVoice };
for (const [lng, bundle] of Object.entries(bundles)) {
  if (!i18n.hasResourceBundle(lng, VOICE_NS)) {
    i18n.addResourceBundle(lng, VOICE_NS, bundle, true, false);
  }
}

export { i18n as voiceI18n };
