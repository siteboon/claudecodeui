import { useState, useEffect } from 'react';

/**
 * Custom hook for unified settings management.
 * Manages hierarchical settings files and localStorage with bidirectional sync.
 * 
 * @param {string|null} projectPath - Current project path for project-specific settings
 * @returns {Object} Settings state and control functions
 */
export const useSettings = (projectPath = null) => {
  const [settings, setSettings] = useState({
    ui: {
      theme: 'system',
      autoExpandTools: false,
      showRawParameters: false,
      autoScrollToBottom: true,
      sendByCtrlEnter: false
    },
    whisper: {
      mode: 'default'
    },
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false,
    projectSortOrder: 'name'
  });
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load settings from server and merge with localStorage
  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get merged settings from server
      const response = await fetch(`/api/settings/merged${projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : ''}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load settings: ${response.statusText}`);
      }
      
      const mergedSettings = await response.json();
      
      // Supplement/override with localStorage settings
      const localSettings = getLocalStorageSettings();
      const finalSettings = mergeLocalSettings(mergedSettings, localSettings);
      
      setSettings(finalSettings);
    } catch (err) {
      console.error('Error loading settings:', err);
      setError(err.message);
      
      // Fallback to localStorage only on error
      const localSettings = getLocalStorageSettings();
      setSettings(prev => ({ ...prev, ...localSettings }));
    } finally {
      setLoading(false);
    }
  };

  // Get settings from localStorage
  const getLocalStorageSettings = () => {
    const localSettings = {};
    
    // UI settings
    const autoExpandTools = localStorage.getItem('autoExpandTools');
    if (autoExpandTools !== null) {
      localSettings.ui = { ...localSettings.ui, autoExpandTools: JSON.parse(autoExpandTools) };
    }
    
    const showRawParameters = localStorage.getItem('showRawParameters');
    if (showRawParameters !== null) {
      localSettings.ui = { ...localSettings.ui, showRawParameters: JSON.parse(showRawParameters) };
    }
    
    const autoScrollToBottom = localStorage.getItem('autoScrollToBottom');
    if (autoScrollToBottom !== null) {
      localSettings.ui = { ...localSettings.ui, autoScrollToBottom: JSON.parse(autoScrollToBottom) };
    }
    
    const sendByCtrlEnter = localStorage.getItem('sendByCtrlEnter');
    if (sendByCtrlEnter !== null) {
      localSettings.ui = { ...localSettings.ui, sendByCtrlEnter: JSON.parse(sendByCtrlEnter) };
    }
    
    const theme = localStorage.getItem('theme');
    if (theme !== null) {
      localSettings.ui = { ...localSettings.ui, theme };
    }
    
    // Whisper settings
    const whisperMode = localStorage.getItem('whisperMode');
    if (whisperMode !== null) {
      localSettings.whisper = { ...localSettings.whisper, mode: whisperMode };
    }
    
    // Tool settings
    const claudeToolsSettings = localStorage.getItem('claude-tools-settings');
    if (claudeToolsSettings) {
      try {
        const toolsSettings = JSON.parse(claudeToolsSettings);
        if (toolsSettings.allowedTools) localSettings.allowedTools = toolsSettings.allowedTools;
        if (toolsSettings.disallowedTools) localSettings.disallowedTools = toolsSettings.disallowedTools;
        if (typeof toolsSettings.skipPermissions === 'boolean') localSettings.skipPermissions = toolsSettings.skipPermissions;
      } catch (e) {
        console.warn('Error parsing claude-tools-settings from localStorage:', e);
      }
    }
    
    return localSettings;
  };

  // Merge local settings with server settings
  const mergeLocalSettings = (serverSettings, localSettings) => {
    const merged = { ...serverSettings };
    
    // Merge UI settings
    if (localSettings.ui) {
      merged.ui = { ...merged.ui, ...localSettings.ui };
    }
    
    // Merge whisper settings
    if (localSettings.whisper) {
      merged.whisper = { ...merged.whisper, ...localSettings.whisper };
    }
    
    // Override tool settings (local takes priority)
    if (localSettings.allowedTools) merged.allowedTools = localSettings.allowedTools;
    if (localSettings.disallowedTools) merged.disallowedTools = localSettings.disallowedTools;
    if (typeof localSettings.skipPermissions === 'boolean') merged.skipPermissions = localSettings.skipPermissions;
    
    return merged;
  };

  // Update settings function
  const updateSettings = async (updates, saveToFile = true) => {
    try {
      // Validate updates
      if (!updates || typeof updates !== 'object') {
        throw new Error('Invalid settings update');
      }
      
      const newSettings = { ...settings };
      
      // Update settings
      Object.keys(updates).forEach(key => {
        if (typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
          newSettings[key] = { ...newSettings[key], ...updates[key] };
        } else {
          newSettings[key] = updates[key];
        }
      });
      
      // Update state immediately
      setSettings(newSettings);
      
      // Update localStorage
      updateLocalStorage(updates);
      
      // Save to settings file
      if (saveToFile) {
        await saveSettingsToFile(newSettings);
      }
      
      // Clear error on success
      setError(null);
      
    } catch (err) {
      console.error('Error updating settings:', err);
      setError(err.message);
      throw err; // Re-throw for caller to handle
    }
  };

  // Update localStorage with new settings
  const updateLocalStorage = (updates) => {
    // Save UI settings to localStorage
    if (updates.ui) {
      Object.keys(updates.ui).forEach(key => {
        localStorage.setItem(key, JSON.stringify(updates.ui[key]));
      });
    }
    
    // Save whisper settings to localStorage
    if (updates.whisper?.mode) {
      localStorage.setItem('whisperMode', updates.whisper.mode);
    }
    
    // Save tool settings to localStorage
    if (updates.allowedTools || updates.disallowedTools || typeof updates.skipPermissions === 'boolean') {
      const claudeToolsSettings = {
        allowedTools: updates.allowedTools || settings.allowedTools,
        disallowedTools: updates.disallowedTools || settings.disallowedTools,
        skipPermissions: updates.skipPermissions !== undefined ? updates.skipPermissions : settings.skipPermissions
      };
      localStorage.setItem('claude-tools-settings', JSON.stringify(claudeToolsSettings));
    }
  };

  // Save settings to file
  const saveSettingsToFile = async (settingsToSave) => {
    try {
      // Determine whether to save as project settings or global settings
      const endpoint = projectPath ? '/api/settings/project' : '/api/settings/global';
      const body = projectPath 
        ? { projectPath, settings: settingsToSave }
        : settingsToSave;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('auth-token')}`
        },
        body: JSON.stringify(body)
      });
      
      if (!response.ok) {
        throw new Error(`Failed to save settings: ${response.statusText}`);
      }
      
    } catch (err) {
      console.error('Error saving settings to file:', err);
      throw err;
    }
  };

  // Initial load
  useEffect(() => {
    loadSettings();
  }, [projectPath]);

  // Listen for whisperModeChanged events
  useEffect(() => {
    const handleWhisperModeChanged = () => {
      const mode = localStorage.getItem('whisperMode') || 'default';
      setSettings(prev => ({
        ...prev,
        whisper: { ...prev.whisper, mode }
      }));
    };

    window.addEventListener('whisperModeChanged', handleWhisperModeChanged);
    return () => window.removeEventListener('whisperModeChanged', handleWhisperModeChanged);
  }, []);

  return {
    settings,
    loading,
    error,
    updateSettings,
    reloadSettings: loadSettings
  };
};

export default useSettings;