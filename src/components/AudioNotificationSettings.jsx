import { useState, useEffect } from 'react';
import { audioService } from '../services/audioService';

export default function AudioNotificationSettings({ className = '' }) {
  const [isEnabled, setIsEnabled] = useState(false);
  const [settings, setSettings] = useState({
    volume: 0.7,
    rate: 1.0,
    pitch: 1.0,
    fallbackToBeep: true
  });
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Backend TTS settings
  const [backendTTSSettings, setBackendTTSSettings] = useState(null);
  const [ttsProviders, setTTSProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState('auto');
  const [isBackendTTSEnabled, setIsBackendTTSEnabled] = useState(true);
  const [apiKeys, setApiKeys] = useState({
    elevenlabs: '',
    deepgram: '',
    openai: '',
    ibm_watson: ''
  });
  const [engineerName, setEngineerName] = useState('');
  const [nameChance, setNameChance] = useState(0.3);

  useEffect(() => {
    // Load initial settings
    setIsEnabled(audioService.getEnabled());
    setSettings(audioService.settings);
    
    // Load available voices
    loadVoices();
    
    // Load backend TTS settings
    loadBackendTTSSettings();
    loadTTSProviders();
    
    // Listen for voice changes
    if ('speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }

    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      }
    };
  }, []);

  const loadVoices = () => {
    if ('speechSynthesis' in window) {
      const availableVoices = window.speechSynthesis.getVoices();
      const englishVoices = availableVoices.filter(voice => 
        voice.lang.startsWith('en')
      );
      setVoices(englishVoices);
      
      if (audioService.settings.voice) {
        setSelectedVoice(audioService.settings.voice.name);
      }
    }
  };

  const loadBackendTTSSettings = async () => {
    try {
      const response = await fetch('/api/settings/tts', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`
        }
      });
      
      if (response.ok) {
        const settings = await response.json();
        setBackendTTSSettings(settings);
        setSelectedProvider(settings.provider || 'auto');
        setIsBackendTTSEnabled(settings.enabled !== false);
        setEngineerName(settings.general?.engineerName || '');
        setNameChance(settings.general?.nameChance || 0.3);
        
        // Don't show masked API keys, but indicate if they're set
        setApiKeys({
          elevenlabs: settings.elevenlabs?.apiKey === '***masked***' ? 'SET' : '',
          deepgram: settings.deepgram?.apiKey === '***masked***' ? 'SET' : '',
          openai: settings.openai?.apiKey === '***masked***' ? 'SET' : '',
          ibm_watson: settings.ibm_watson?.apiKey === '***masked***' ? 'SET' : ''
        });
      }
    } catch (error) {
      console.error('Error loading backend TTS settings:', error);
    }
  };

  const loadTTSProviders = async () => {
    try {
      const response = await fetch('/api/settings/tts/providers');
      
      if (response.ok) {
        const providers = await response.json();
        setTTSProviders(providers);
        console.log('🎵 Loaded TTS providers:', providers);
      } else {
        console.error('Failed to load TTS providers:', response.status);
      }
    } catch (error) {
      console.error('Error loading TTS providers:', error);
    }
  };

  const handleToggleEnabled = (enabled) => {
    setIsEnabled(enabled);
    audioService.setEnabled(enabled);
  };

  const handleSettingChange = (key, value) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    audioService.updateSettings(newSettings);
  };

  const handleVoiceChange = (voiceName) => {
    setSelectedVoice(voiceName);
    const voice = voices.find(v => v.name === voiceName);
    if (voice) {
      audioService.updateSettings({ voice });
    }
  };

  const saveBackendTTSSettings = async () => {
    if (!backendTTSSettings) return;
    
    try {
      setIsLoading(true);
      
      const updatedSettings = {
        ...backendTTSSettings,
        enabled: isBackendTTSEnabled,
        provider: selectedProvider,
        general: {
          ...backendTTSSettings.general,
          engineerName,
          nameChance
        }
      };
      
      // Only update API keys if they're actually changed (not just 'SET')
      if (apiKeys.elevenlabs && apiKeys.elevenlabs !== 'SET') {
        updatedSettings.elevenlabs = {
          ...updatedSettings.elevenlabs,
          apiKey: apiKeys.elevenlabs
        };
      }
      
      if (apiKeys.deepgram && apiKeys.deepgram !== 'SET') {
        updatedSettings.deepgram = {
          ...updatedSettings.deepgram,
          apiKey: apiKeys.deepgram
        };
      }
      
      if (apiKeys.openai && apiKeys.openai !== 'SET') {
        updatedSettings.openai = {
          ...updatedSettings.openai,
          apiKey: apiKeys.openai
        };
      }
      
      if (apiKeys.ibm_watson && apiKeys.ibm_watson !== 'SET') {
        updatedSettings.ibm_watson = {
          ...updatedSettings.ibm_watson,
          apiKey: apiKeys.ibm_watson
        };
      }
      
      const response = await fetch('/api/settings/tts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`
        },
        body: JSON.stringify(updatedSettings)
      });
      
      if (response.ok) {
        // Update local state with the saved settings (preserve UI state)
        setBackendTTSSettings(updatedSettings);
        
        // Only update API key display to show 'SET' status
        setApiKeys({
          elevenlabs: updatedSettings.elevenlabs?.apiKey ? 'SET' : '',
          deepgram: updatedSettings.deepgram?.apiKey ? 'SET' : '',
          openai: updatedSettings.openai?.apiKey ? 'SET' : '',
          ibm_watson: updatedSettings.ibm_watson?.apiKey ? 'SET' : ''
        });
        
        console.log('✅ Backend TTS settings saved');
      } else {
        console.error('❌ Failed to save backend TTS settings');
      }
    } catch (error) {
      console.error('Error saving backend TTS settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestNotification = async () => {
    setIsLoading(true);
    try {
      // Save current settings first to ensure backend gets the updated voice model
      if (isBackendTTSEnabled) {
        await saveBackendTTSSettings();
        
        // Small delay to ensure settings are saved
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const response = await fetch('/api/settings/tts/test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('auth-token')}`
          },
          body: JSON.stringify({
            message: selectedProvider === 'deepgram' && backendTTSSettings?.deepgram?.voiceModel 
              ? `Testing Deepgram ${backendTTSSettings.deepgram.voiceModel.replace('aura-', '').replace('-en', '')} voice - Audio notifications are working correctly`
              : 'Backend TTS test - Audio notifications are working correctly',
            provider: selectedProvider
          })
        });
        
        if (response.ok) {
          console.log('🎵 Backend TTS test initiated with updated settings');
        } else {
          throw new Error('Backend TTS test failed');
        }
      } else {
        // Fallback to browser TTS
        await audioService.testNotification();
      }
    } catch (error) {
      console.error('Test notification failed, trying browser TTS:', error);
      await audioService.testNotification();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`audio-notification-settings ${className}`}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            Audio Notifications
          </h3>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
              className="sr-only"
            />
            <div className={`relative w-11 h-6 rounded-full transition-colors ${
              isEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
            }`}>
              <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                isEnabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </div>
          </label>
        </div>

        {isEnabled && (
          <div className="space-y-6">
            {/* Backend TTS Settings */}
            <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-md font-medium text-gray-900 dark:text-gray-100">
                  Backend TTS (Recommended)
                </h4>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isBackendTTSEnabled}
                    onChange={(e) => setIsBackendTTSEnabled(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`relative w-11 h-6 rounded-full transition-colors ${
                    isBackendTTSEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                  }`}>
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                      isBackendTTSEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                </label>
              </div>

              {isBackendTTSEnabled && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      TTS Provider
                    </label>
                    <select
                      value={selectedProvider}
                      onChange={(e) => setSelectedProvider(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      {ttsProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {ttsProviders.find(p => p.id === selectedProvider)?.description}
                    </p>
                  </div>

                  {(selectedProvider === 'elevenlabs' || selectedProvider === 'auto') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        ElevenLabs API Key
                      </label>
                      <input
                        type="password"
                        value={apiKeys.elevenlabs}
                        onChange={(e) => setApiKeys(prev => ({ ...prev, elevenlabs: e.target.value }))}
                        placeholder={apiKeys.elevenlabs === 'SET' ? 'API key is configured' : 'Enter ElevenLabs API key'}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                  )}

                  {(selectedProvider === 'deepgram' || selectedProvider === 'auto') && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Deepgram API Key
                        </label>
                        <input
                          type="password"
                          value={apiKeys.deepgram}
                          onChange={(e) => setApiKeys(prev => ({ ...prev, deepgram: e.target.value }))}
                          placeholder={apiKeys.deepgram === 'SET' ? 'API key is configured' : 'Enter Deepgram API key'}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Voice Model
                        </label>
                        <select
                          value={backendTTSSettings?.deepgram?.voiceModel || 'aura-helios-en'}
                          onChange={(e) => setBackendTTSSettings(prev => ({
                            ...prev,
                            deepgram: {
                              ...prev?.deepgram,
                              voiceModel: e.target.value
                            }
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        >
                          <option value="aura-helios-en">Helios - Warm, confident male voice</option>
                          <option value="aura-luna-en">Luna - Smooth, professional female voice</option>
                          <option value="aura-stella-en">Stella - Clear, articulate female voice</option>
                          <option value="aura-athena-en">Athena - Authoritative, intelligent female voice</option>
                          <option value="aura-hera-en">Hera - Rich, expressive female voice</option>
                          <option value="aura-orion-en">Orion - Deep, resonant male voice</option>
                          <option value="aura-arcas-en">Arcas - Friendly, approachable male voice</option>
                          <option value="aura-perseus-en">Perseus - Strong, reliable male voice</option>
                          <option value="aura-angus-en">Angus - Distinctive, character-rich male voice</option>
                          <option value="aura-orpheus-en">Orpheus - Melodic, engaging male voice</option>
                          <option value="aura-electra-en">Electra - Dynamic, energetic female voice</option>
                          <option value="aura-zeus-en">Zeus - Powerful, commanding male voice</option>
                        </select>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Choose from Deepgram's high-quality Aura TTS voice models
                        </p>
                      </div>
                    </div>
                  )}

                  {(selectedProvider === 'openai' || selectedProvider === 'auto') && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        OpenAI API Key
                      </label>
                      <input
                        type="password"
                        value={apiKeys.openai}
                        onChange={(e) => setApiKeys(prev => ({ ...prev, openai: e.target.value }))}
                        placeholder={apiKeys.openai === 'SET' ? 'API key is configured' : 'Enter OpenAI API key'}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                  )}

                  {(selectedProvider === 'ibm_watson' || selectedProvider === 'auto') && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          IBM Watson API Key
                        </label>
                        <input
                          type="password"
                          value={apiKeys.ibm_watson}
                          onChange={(e) => setApiKeys(prev => ({ ...prev, ibm_watson: e.target.value }))}
                          placeholder={apiKeys.ibm_watson === 'SET' ? 'API key is configured' : 'Enter IBM Watson API key'}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          IBM Watson API URL
                        </label>
                        <input
                          type="text"
                          value={backendTTSSettings?.ibm_watson?.apiUrl || ''}
                          onChange={(e) => setBackendTTSSettings(prev => ({
                            ...prev,
                            ibm_watson: {
                              ...prev?.ibm_watson,
                              apiUrl: e.target.value
                            }
                          }))}
                          placeholder="https://api.us-south.text-to-speech.watson.cloud.ibm.com"
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        />
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Voice
                        </label>
                        <select
                          value={backendTTSSettings?.ibm_watson?.voice || 'en-US_MichaelV3Voice'}
                          onChange={(e) => setBackendTTSSettings(prev => ({
                            ...prev,
                            ibm_watson: {
                              ...prev?.ibm_watson,
                              voice: e.target.value
                            }
                          }))}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        >
                          <option value="en-US_MichaelV3Voice">Michael - Friendly US male voice</option>
                          <option value="en-US_AllisonV3Voice">Allison - Professional US female voice</option>
                          <option value="en-US_LisaV3Voice">Lisa - Clear US female voice</option>
                          <option value="en-US_KevinV3Voice">Kevin - Confident US male voice</option>
                          <option value="en-US_OliviaV3Voice">Olivia - Warm US female voice</option>
                          <option value="en-GB_JamesV3Voice">James - British male voice</option>
                          <option value="en-GB_CharlotteV3Voice">Charlotte - British female voice</option>
                        </select>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Choose from IBM Watson's high-quality neural voices
                        </p>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Engineer Name (Optional)
                    </label>
                    <input
                      type="text"
                      value={engineerName}
                      onChange={(e) => setEngineerName(e.target.value)}
                      placeholder="Your name for personalized notifications"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Name Usage Frequency: {Math.round(nameChance * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={nameChance}
                      onChange={(e) => setNameChance(parseFloat(e.target.value))}
                      className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      How often your name is included in notifications
                    </p>
                  </div>

                  <button
                    onClick={saveBackendTTSSettings}
                    disabled={isLoading}
                    className={`w-full px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                      isLoading
                        ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700 text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2'
                    }`}
                  >
                    {isLoading ? 'Saving...' : 'Save Backend TTS Settings'}
                  </button>
                </div>
              )}
            </div>

            {/* Browser TTS Settings */}
            <div>
              <h4 className="text-md font-medium text-gray-900 dark:text-gray-100 mb-3">
                Browser TTS (Fallback)
              </h4>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Voice
                  </label>
                  <select
                    value={selectedVoice}
                    onChange={(e) => handleVoiceChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  >
                    <option value="">Default Voice</option>
                    {voices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} ({voice.lang})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Volume: {Math.round(settings.volume * 100)}%
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.volume}
                onChange={(e) => handleSettingChange('volume', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Speed: {settings.rate}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={settings.rate}
                onChange={(e) => handleSettingChange('rate', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Pitch: {settings.pitch}x
              </label>
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.1"
                value={settings.pitch}
                onChange={(e) => handleSettingChange('pitch', parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="fallbackToBeep"
                checked={settings.fallbackToBeep}
                onChange={(e) => handleSettingChange('fallbackToBeep', e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600 rounded"
              />
              <label
                htmlFor="fallbackToBeep"
                className="ml-2 block text-sm text-gray-700 dark:text-gray-300"
              >
                Play beep if speech synthesis fails
              </label>
            </div>

                <button
                  onClick={handleTestNotification}
                  disabled={isLoading}
                  className={`w-full px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    isLoading
                      ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                      : 'bg-blue-600 hover:bg-blue-700 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
                  }`}
                >
                  {isLoading ? 'Testing...' : 'Test Audio Notification'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="text-xs text-gray-500 dark:text-gray-400">
          Audio notifications will play when Claude needs your input or completes tasks.
          {!('speechSynthesis' in window) && (
            <div className="mt-1 text-red-500">
              ⚠️ Text-to-speech is not supported in this browser.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}