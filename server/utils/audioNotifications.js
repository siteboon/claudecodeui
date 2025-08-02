// Audio notification utilities for claudecodeui
import { promises as fs } from 'fs';
import path from 'path';

// Audio notification settings
const AUDIO_NOTIFICATION_SETTINGS = {
  enableTTS: process.env.ENABLE_TTS_NOTIFICATIONS === 'true' || false,
  openaiApiKey: process.env.OPENAI_API_KEY,
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY,
  defaultVoice: process.env.TTS_VOICE || 'nova',
  engineerName: process.env.ENGINEER_NAME || '',
  notificationChance: parseFloat(process.env.TTS_NAME_CHANCE || '0.3')
};

// Generate audio notification message
export function generateNotificationMessage(messageType = 'input', customMessage = '') {
  if (customMessage) return customMessage;
  
  const messages = {
    input: ['Your agent needs your input', 'Claude is waiting for you', 'Agent needs assistance'],
    complete: ['Task completed successfully', 'Agent has finished', 'Work is done'],
    error: ['There was an error', 'Something went wrong', 'Agent encountered an issue'],
    session_start: ['New session started', 'Agent is ready', 'Claude is online'],
    session_end: ['Session ended', 'Agent signed off', 'Claude is offline']
  };
  
  const messageList = messages[messageType] || messages.input;
  const baseMessage = messageList[Math.floor(Math.random() * messageList.length)];
  
  // Add engineer name with configured probability
  if (AUDIO_NOTIFICATION_SETTINGS.engineerName && Math.random() < AUDIO_NOTIFICATION_SETTINGS.notificationChance) {
    return `${AUDIO_NOTIFICATION_SETTINGS.engineerName}, ${baseMessage.toLowerCase()}`;
  }
  
  return baseMessage;
}

// Create audio notification object
export function createAudioNotification(messageType, customMessage = '', metadata = {}) {
  const notificationMessage = generateNotificationMessage(messageType, customMessage);
  return {
    type: 'audio-notification',
    messageType,
    message: notificationMessage,
    timestamp: new Date().toISOString(),
    ttsEnabled: AUDIO_NOTIFICATION_SETTINGS.enableTTS,
    voice: AUDIO_NOTIFICATION_SETTINGS.defaultVoice,
    metadata
  };
}

// Check if TTS is enabled
export function isTTSEnabled() {
  return AUDIO_NOTIFICATION_SETTINGS.enableTTS;
}

// Get TTS settings
export function getTTSSettings() {
  return { ...AUDIO_NOTIFICATION_SETTINGS };
}