// voiceRoutes: used by the server entrypoint to mount authenticated STT/TTS endpoints.
export { voiceRoutes } from './voice.module.js';
// ClaudeSpeechStream: used by the websocket module to bridge dictation to
// Anthropic's speech-to-text with this machine's Claude credentials.
export { ClaudeSpeechStream, readClaudeToken } from './claude-speech.service.js';
