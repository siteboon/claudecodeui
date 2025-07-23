// Settings management for TTS and hook configurations
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Default TTS settings
const DEFAULT_TTS_SETTINGS = {
  enabled: true,
  provider: 'auto', // auto, elevenlabs, deepgram, openai, ibm_watson, pyttsx3
  elevenlabs: {
    apiKey: '',
    voiceId: 'WejK3H1m7MI9CHnIjW9K',
    model: 'eleven_turbo_v2_5'
  },
  deepgram: {
    apiKey: '',
    voiceModel: 'aura-helios-en'
  },
  openai: {
    apiKey: '',
    voice: 'nova',
    model: 'gpt-4o-mini-tts',
    instructions: 'Speak in a cheerful, positive yet professional tone.'
  },
  ibm_watson: {
    apiKey: '',
    apiUrl: '',
    voice: 'en-US_MichaelV3Voice'
  },
  pyttsx3: {
    rate: 180,
    volume: 0.8
  },
  general: {
    engineerName: '',
    nameChance: 0.3,
    claudecodeui: {
      enabled: true,
      url: 'http://localhost:3000'
    }
  }
};

// Get settings file paths
function getSettingsPaths() {
  const claudecodeUIRoot = path.resolve(__dirname, '../../');
  return {
    envFile: path.join(claudecodeUIRoot, '.env'),
    settingsFile: path.join(__dirname, '../data/tts-settings.json')
  };
}

// Load current TTS settings from environment and stored config
async function loadTTSSettings() {
  try {
    const paths = getSettingsPaths();
    let settings = { ...DEFAULT_TTS_SETTINGS };
    
    // Try to load stored settings
    try {
      const settingsData = await fs.readFile(paths.settingsFile, 'utf8');
      const storedSettings = JSON.parse(settingsData);
      settings = { ...settings, ...storedSettings };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('Error loading TTS settings file:', error.message);
      }
    }
    
    // Override with environment variables
    if (process.env.ELEVENLABS_API_KEY) {
      settings.elevenlabs.apiKey = process.env.ELEVENLABS_API_KEY;
    }
    if (process.env.ELEVENLABS_VOICE_ID) {
      settings.elevenlabs.voiceId = process.env.ELEVENLABS_VOICE_ID;
    }
    if (process.env.ELEVENLABS_MODEL) {
      settings.elevenlabs.model = process.env.ELEVENLABS_MODEL;
    }
    
    if (process.env.DEEPGRAM_API_KEY) {
      settings.deepgram.apiKey = process.env.DEEPGRAM_API_KEY;
    }
    if (process.env.DEEPGRAM_VOICE_MODEL) {
      settings.deepgram.voiceModel = process.env.DEEPGRAM_VOICE_MODEL;
    }
    
    if (process.env.OPENAI_API_KEY) {
      settings.openai.apiKey = process.env.OPENAI_API_KEY;
    }
    if (process.env.OPENAI_TTS_VOICE) {
      settings.openai.voice = process.env.OPENAI_TTS_VOICE;
    }
    if (process.env.OPENAI_TTS_MODEL) {
      settings.openai.model = process.env.OPENAI_TTS_MODEL;
    }
    if (process.env.OPENAI_TTS_INSTRUCTIONS) {
      settings.openai.instructions = process.env.OPENAI_TTS_INSTRUCTIONS;
    }
    
    if (process.env.IBM_API_KEY) {
      settings.ibm_watson.apiKey = process.env.IBM_API_KEY;
    }
    if (process.env.IBM_API_URL) {
      settings.ibm_watson.apiUrl = process.env.IBM_API_URL;
    }
    if (process.env.IBM_WATSON_VOICE) {
      settings.ibm_watson.voice = process.env.IBM_WATSON_VOICE;
    }
    
    if (process.env.PYTTSX3_RATE) {
      settings.pyttsx3.rate = parseInt(process.env.PYTTSX3_RATE);
    }
    if (process.env.PYTTSX3_VOLUME) {
      settings.pyttsx3.volume = parseFloat(process.env.PYTTSX3_VOLUME);
    }
    
    if (process.env.ENGINEER_NAME) {
      settings.general.engineerName = process.env.ENGINEER_NAME;
    }
    if (process.env.TTS_NAME_CHANCE) {
      settings.general.nameChance = parseFloat(process.env.TTS_NAME_CHANCE);
    }
    if (process.env.ENABLE_CLAUDECODEUI_NOTIFICATIONS) {
      settings.general.claudecodeui.enabled = process.env.ENABLE_CLAUDECODEUI_NOTIFICATIONS.toLowerCase() === 'true';
    }
    if (process.env.CLAUDECODEUI_URL) {
      settings.general.claudecodeui.url = process.env.CLAUDECODEUI_URL;
    }
    
    return settings;
  } catch (error) {
    console.error('Error loading TTS settings:', error.message);
    return DEFAULT_TTS_SETTINGS;
  }
}

// Save TTS settings to file and environment
async function saveTTSSettings(settings) {
  try {
    const paths = getSettingsPaths();
    
    // Ensure data directory exists
    await fs.mkdir(path.dirname(paths.settingsFile), { recursive: true });
    
    // Create settings copy without API keys for JSON storage
    const settingsForJson = JSON.parse(JSON.stringify(settings));
    settingsForJson.elevenlabs.apiKey = '';
    settingsForJson.deepgram.apiKey = '';
    settingsForJson.openai.apiKey = '';
    settingsForJson.ibm_watson.apiKey = '';
    
    // Save settings to JSON file (without API keys)
    await fs.writeFile(paths.settingsFile, JSON.stringify(settingsForJson, null, 2));
    
    // Generate environment variables content (only non-sensitive settings)
    const envContent = generateEnvContent(settings);
    
    // Update only non-API-key settings in .env file
    await updateEnvFilePreservingAPIKeys(paths.envFile, envContent);
    
    console.log('✅ TTS settings saved successfully (API keys preserved)');
    return true;
  } catch (error) {
    console.error('❌ Error saving TTS settings:', error.message);
    throw error;
  }
}

// Generate environment variables content from settings
function generateEnvContent(settings) {
  const lines = [];
  
  lines.push('# TTS Configuration');
  
  // NEVER write API keys - they should only be read from .env
  if (settings.elevenlabs.voiceId) {
    lines.push(`ELEVENLABS_VOICE_ID=${settings.elevenlabs.voiceId}`);
  }
  if (settings.elevenlabs.model) {
    lines.push(`ELEVENLABS_MODEL=${settings.elevenlabs.model}`);
  }
  
  if (settings.deepgram.voiceModel) {
    lines.push(`DEEPGRAM_VOICE_MODEL=${settings.deepgram.voiceModel}`);
  }
  
  if (settings.openai.voice) {
    lines.push(`OPENAI_TTS_VOICE=${settings.openai.voice}`);
  }
  if (settings.openai.model) {
    lines.push(`OPENAI_TTS_MODEL=${settings.openai.model}`);
  }
  if (settings.openai.instructions) {
    lines.push(`OPENAI_TTS_INSTRUCTIONS=${settings.openai.instructions}`);
  }
  
  if (settings.ibm_watson.apiUrl) {
    lines.push(`IBM_API_URL=${settings.ibm_watson.apiUrl}`);
  }
  if (settings.ibm_watson.voice) {
    lines.push(`IBM_WATSON_VOICE=${settings.ibm_watson.voice}`);
  }
  
  if (settings.pyttsx3.rate) {
    lines.push(`PYTTSX3_RATE=${settings.pyttsx3.rate}`);
  }
  if (settings.pyttsx3.volume) {
    lines.push(`PYTTSX3_VOLUME=${settings.pyttsx3.volume}`);
  }
  
  if (settings.general.engineerName) {
    lines.push(`ENGINEER_NAME=${settings.general.engineerName}`);
  }
  if (settings.general.nameChance !== undefined) {
    lines.push(`TTS_NAME_CHANCE=${settings.general.nameChance}`);
  }
  if (settings.general.claudecodeui.enabled !== undefined) {
    lines.push(`ENABLE_CLAUDECODEUI_NOTIFICATIONS=${settings.general.claudecodeui.enabled ? 'true' : 'false'}`);
  }
  if (settings.general.claudecodeui.url) {
    lines.push(`CLAUDECODEUI_URL=${settings.general.claudecodeui.url}`);
  }
  
  return lines.join('\n') + '\n';
}

// Update environment file while preserving other variables
async function updateEnvFile(filePath, newContent) {
  try {
    let existingContent = '';
    try {
      existingContent = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    // Parse existing content
    const existingLines = existingContent.split('\n');
    const ttsKeys = new Set([
      'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL',
      'DEEPGRAM_API_KEY', 'DEEPGRAM_VOICE_MODEL',
      'OPENAI_API_KEY', 'OPENAI_TTS_VOICE', 'OPENAI_TTS_MODEL', 'OPENAI_TTS_INSTRUCTIONS',
      'IBM_API_KEY', 'IBM_API_URL', 'IBM_WATSON_VOICE',
      'PYTTSX3_RATE', 'PYTTSX3_VOLUME',
      'ENGINEER_NAME', 'TTS_NAME_CHANCE',
      'ENABLE_CLAUDECODEUI_NOTIFICATIONS', 'CLAUDECODEUI_URL'
    ]);
    
    // Filter out existing TTS-related lines and TTS comments
    const filteredLines = existingLines.filter(line => {
      const trimmed = line.trim();
      
      // Remove TTS configuration comment lines
      if (trimmed === '# TTS Configuration') return false;
      
      // Keep empty lines and other comments
      if (!trimmed || (trimmed.startsWith('#') && trimmed !== '# TTS Configuration')) return true;
      
      // Remove TTS key-value pairs
      const key = trimmed.split('=')[0];
      return !ttsKeys.has(key);
    });
    
    // Add new TTS content
    const cleanedContent = filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const finalContent = cleanedContent + '\n\n' + newContent;
    
    await fs.writeFile(filePath, finalContent);
  } catch (error) {
    console.error(`Error updating ${filePath}:`, error.message);
    throw error;
  }
}

// Update env file while preserving API keys
async function updateEnvFilePreservingAPIKeys(filePath, newContent) {
  try {
    let existingContent = '';
    try {
      existingContent = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    // Parse existing content and preserve API keys
    const existingLines = existingContent.split('\n');
    const apiKeyLines = existingLines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith('ELEVENLABS_API_KEY=') ||
             trimmed.startsWith('DEEPGRAM_API_KEY=') ||
             trimmed.startsWith('OPENAI_API_KEY=') ||
             trimmed.startsWith('IBM_API_KEY=');
    });
    
    // Remove TTS settings but keep API keys and other content
    const nonTTSKeys = new Set([
      'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL',
      'DEEPGRAM_VOICE_MODEL',
      'OPENAI_TTS_VOICE', 'OPENAI_TTS_MODEL', 'OPENAI_TTS_INSTRUCTIONS',
      'IBM_API_URL', 'IBM_WATSON_VOICE',
      'PYTTSX3_RATE', 'PYTTSX3_VOLUME',
      'ENGINEER_NAME', 'TTS_NAME_CHANCE',
      'ENABLE_CLAUDECODEUI_NOTIFICATIONS', 'CLAUDECODEUI_URL'
    ]);
    
    const filteredLines = existingLines.filter(line => {
      const trimmed = line.trim();
      
      // Keep empty lines and non-TTS comments
      if (!trimmed || (trimmed.startsWith('#') && trimmed !== '# TTS Configuration')) return true;
      
      // Remove TTS Configuration section header to prevent duplicates
      if (trimmed === '# TTS Configuration') return false;
      
      // Keep API keys
      if (trimmed.startsWith('ELEVENLABS_API_KEY=') ||
          trimmed.startsWith('DEEPGRAM_API_KEY=') ||
          trimmed.startsWith('OPENAI_API_KEY=') ||
          trimmed.startsWith('IBM_API_KEY=')) return true;
      
      // Remove non-API TTS settings that will be replaced
      const key = trimmed.split('=')[0];
      return !nonTTSKeys.has(key);
    });
    
    // Add new non-API content
    const cleanedContent = filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const finalContent = cleanedContent + '\n\n' + newContent;
    
    await fs.writeFile(filePath, finalContent);
  } catch (error) {
    console.error(`Error updating ${filePath}:`, error.message);
    throw error;
  }
}

// Get current TTS settings (protected)
router.get('/tts', authenticateToken, async (req, res) => {
  try {
    const settings = await loadTTSSettings();
    
    // Don't expose API keys in the response
    const safeSettings = {
      ...settings,
      elevenlabs: {
        ...settings.elevenlabs,
        apiKey: settings.elevenlabs.apiKey ? '***masked***' : ''
      },
      deepgram: {
        ...settings.deepgram,
        apiKey: settings.deepgram.apiKey ? '***masked***' : ''
      },
      openai: {
        ...settings.openai,
        apiKey: settings.openai.apiKey ? '***masked***' : ''
      },
      ibm_watson: {
        ...settings.ibm_watson,
        apiKey: settings.ibm_watson.apiKey ? '***masked***' : ''
      }
    };
    
    res.json(safeSettings);
  } catch (error) {
    console.error('❌ Error getting TTS settings:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update TTS settings (protected)
router.put('/tts', authenticateToken, async (req, res) => {
  try {
    const currentSettings = await loadTTSSettings();
    const newSettings = { ...currentSettings, ...req.body };
    
    // Remove masked API keys - these should only come from .env file
    if (newSettings.elevenlabs?.apiKey === '***masked***') {
      newSettings.elevenlabs.apiKey = currentSettings.elevenlabs.apiKey;
    }
    if (newSettings.deepgram?.apiKey === '***masked***') {
      newSettings.deepgram.apiKey = currentSettings.deepgram.apiKey;
    }
    if (newSettings.openai?.apiKey === '***masked***') {
      newSettings.openai.apiKey = currentSettings.openai.apiKey;
    }
    if (newSettings.ibm_watson?.apiKey === '***masked***') {
      newSettings.ibm_watson.apiKey = currentSettings.ibm_watson.apiKey;
    }
    
    // Validate settings
    if (newSettings.elevenlabs && typeof newSettings.elevenlabs !== 'object') {
      return res.status(400).json({ error: 'Invalid elevenlabs settings' });
    }
    if (newSettings.deepgram && typeof newSettings.deepgram !== 'object') {
      return res.status(400).json({ error: 'Invalid deepgram settings' });
    }
    if (newSettings.openai && typeof newSettings.openai !== 'object') {
      return res.status(400).json({ error: 'Invalid openai settings' });
    }
    if (newSettings.ibm_watson && typeof newSettings.ibm_watson !== 'object') {
      return res.status(400).json({ error: 'Invalid ibm_watson settings' });
    }
    if (newSettings.pyttsx3 && typeof newSettings.pyttsx3 !== 'object') {
      return res.status(400).json({ error: 'Invalid pyttsx3 settings' });
    }
    
    await saveTTSSettings(newSettings);
    
    res.json({
      success: true,
      message: 'TTS settings updated successfully',
      settings: newSettings
    });
  } catch (error) {
    console.error('❌ Error updating TTS settings:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Test TTS with current settings (protected)
router.post('/tts/test', authenticateToken, async (req, res) => {
  try {
    const { message = 'TTS test message', provider = 'auto' } = req.body;
    
    // Import the ClaudeCodeUI notification utility
    const { spawn } = await import('child_process');
    const path = await import('path');
    
    // Path to the ClaudeCodeUI notification script
    const claudecodeUIRoot = path.resolve(__dirname, '../../');
    const notificationScript = path.join(claudecodeUIRoot, '.claude/hooks/utils/claudecodeui_notification.py');
    
    // Check if the script exists
    const fs = await import('fs');
    if (!fs.existsSync(notificationScript)) {
      return res.status(404).json({ 
        error: 'ClaudeCodeUI notification script not found',
        path: notificationScript 
      });
    }
    
    // Spawn the notification script to trigger TTS
    const child = spawn('uv', ['run', notificationScript, 'test', message], {
      env: { 
        ...process.env,
        ENABLE_CLAUDECODEUI_NOTIFICATIONS: 'true',
        CLAUDECODEUI_URL: 'http://localhost:3000'
      },
      timeout: 10000
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        console.log('✅ TTS test completed successfully');
      } else {
        console.log('❌ TTS test failed with code:', code);
      }
    });
    
    // Don't wait for completion, return immediately
    res.json({
      success: true,
      message: 'TTS test initiated with backend audio generation',
      provider,
      testMessage: message
    });
    
  } catch (error) {
    console.error('❌ Error testing TTS:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get available TTS providers (no auth required for basic info)
router.get('/tts/providers', (req, res) => {
  try {
    const providers = [
      {
        id: 'auto',
        name: 'Auto (Best Available)',
        description: 'Automatically selects the best available TTS provider'
      },
      {
        id: 'elevenlabs',
        name: 'ElevenLabs',
        description: 'High-quality neural TTS (requires API key)',
        requiresApiKey: true
      },
      {
        id: 'deepgram',
        name: 'Deepgram Aura',
        description: 'Fast, high-quality Aura TTS models (requires API key)',
        requiresApiKey: true
      },
      {
        id: 'openai',
        name: 'OpenAI TTS',
        description: 'OpenAI text-to-speech (requires API key)',
        requiresApiKey: true
      },
      {
        id: 'ibm_watson',
        name: 'IBM Watson',
        description: 'IBM Watson neural voices (requires API key)',
        requiresApiKey: true
      },
      {
        id: 'pyttsx3',
        name: 'Offline TTS',
        description: 'Local text-to-speech (no API key required)',
        requiresApiKey: false
      }
    ];
    
    res.json(providers);
  } catch (error) {
    console.error('❌ Error getting TTS providers:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;