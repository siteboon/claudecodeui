export { default as ChatInterface } from '@/modules/chat/ChatInterface';
export { getClaudeSettings } from '@/modules/chat/utils/chatStorage';
// Voice overlay: the auto-speak row and the platform-mode check, for Settings and Quick Settings.
export { default as AutoSpeakSetting } from '@/modules/chat/voice/AutoSpeakSetting';
export { VOICE_NS } from '@/modules/chat/voice/voiceI18n';
export { isVoicePlatformMode } from '@/modules/chat/voice/voiceState';
