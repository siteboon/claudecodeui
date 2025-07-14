import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { 
  ChevronLeft, 
  ChevronRight, 
  Maximize2, 
  Eye, 
  Settings2,
  Moon,
  Sun,
  ArrowDown,
  Mic,
  Brain,
  Sparkles,
  FileText,
  Globe,
  Copy,
  Share2,
  CheckCircle,
  XCircle,
  Loader2
} from 'lucide-react';
import DarkModeToggle from './DarkModeToggle';
import { useTheme } from '../contexts/ThemeContext';

const QuickSettingsPanel = ({ 
  isOpen, 
  onToggle,
  autoExpandTools,
  onAutoExpandChange,
  showRawParameters,
  onShowRawParametersChange,
  autoScrollToBottom,
  onAutoScrollChange,
  isMobile
}) => {
  const [localIsOpen, setLocalIsOpen] = useState(isOpen);
  const [whisperMode, setWhisperMode] = useState(() => {
    return localStorage.getItem('whisperMode') || 'default';
  });
  const { isDarkMode } = useTheme();
  
  // Tunnel state
  const [tunnelStatus, setTunnelStatus] = useState({
    isActive: false,
    url: null,
    isLoading: false,
    error: null
  });
  const [copied, setCopied] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState(null);

  useEffect(() => {
    setLocalIsOpen(isOpen);
  }, [isOpen]);

  // Fetch tunnel status on mount and periodically
  useEffect(() => {
    fetchTunnelStatus();
    const interval = setInterval(fetchTunnelStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Generate QR code when tunnel URL changes
  useEffect(() => {
    if (tunnelStatus.url) {
      QRCode.toDataURL(tunnelStatus.url, {
        width: 200,
        margin: 2,
        color: {
          dark: isDarkMode ? '#ffffff' : '#000000',
          light: isDarkMode ? '#1f2937' : '#ffffff'
        }
      })
      .then(url => setQrCodeUrl(url))
      .catch(err => console.error('Error generating QR code:', err));
    } else {
      setQrCodeUrl(null);
    }
  }, [tunnelStatus.url, isDarkMode]);

  const fetchTunnelStatus = async () => {
    try {
      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/tunnel/status', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success) {
        setTunnelStatus(prev => ({
          ...prev,
          isActive: data.isActive,
          url: data.url,
          error: data.error
        }));
      }
    } catch (error) {
      console.error('Error fetching tunnel status:', error);
    }
  };

  const toggleTunnel = async () => {
    setTunnelStatus(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      const token = localStorage.getItem('auth-token');
      const endpoint = tunnelStatus.isActive ? '/api/tunnel/stop' : '/api/tunnel/start';
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (data.success) {
        setTunnelStatus({
          isActive: !tunnelStatus.isActive,
          url: data.url || null,
          isLoading: false,
          error: null
        });
        
        // If tunnel was started, automatically copy URL
        if (data.url) {
          copyToClipboard(data.url);
        }
      } else {
        throw new Error(data.error || 'Failed to toggle tunnel');
      }
    } catch (error) {
      console.error('Error toggling tunnel:', error);
      setTunnelStatus(prev => ({
        ...prev,
        isLoading: false,
        error: error.message
      }));
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const shareUrl = async () => {
    if (!tunnelStatus.url) return;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Claude Code UI',
          text: 'Access Claude Code UI from anywhere',
          url: tunnelStatus.url
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    } else {
      // Fallback to copying
      copyToClipboard(tunnelStatus.url);
    }
  };

  const handleToggle = () => {
    const newState = !localIsOpen;
    setLocalIsOpen(newState);
    onToggle(newState);
  };

  return (
    <>
      {/* Pull Tab */}
      <div
        className={`fixed ${isMobile ? 'bottom-44' : 'top-1/2 -translate-y-1/2'} ${
          localIsOpen ? 'right-64' : 'right-0'
        } z-50 transition-all duration-150 ease-out`}
      >
        <button
          onClick={handleToggle}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-l-md p-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors shadow-lg"
          aria-label={localIsOpen ? 'Close settings panel' : 'Open settings panel'}
        >
          {localIsOpen ? (
            <ChevronRight className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          ) : (
            <ChevronLeft className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          )}
        </button>
      </div>

      {/* Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-64 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-xl transform transition-transform duration-150 ease-out z-40 ${
          localIsOpen ? 'translate-x-0' : 'translate-x-full'
        } ${isMobile ? 'h-screen' : ''}`}
      >
        <div className="h-full flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              Quick Settings
            </h3>
          </div>

          {/* Settings Content */}
          <div className={`flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-6 bg-white dark:bg-gray-900 ${isMobile ? 'pb-20' : ''}`}>
            {/* Appearance Settings */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Appearance</h4>
              
              <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  {isDarkMode ? <Moon className="h-4 w-4 text-gray-600 dark:text-gray-400" /> : <Sun className="h-4 w-4 text-gray-600 dark:text-gray-400" />}
                  Dark Mode
                </span>
                <DarkModeToggle />
              </div>
            </div>

            {/* Tool Display Settings */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Tool Display</h4>
              
              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  <Maximize2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  Auto-expand tools
                </span>
                <input
                  type="checkbox"
                  checked={autoExpandTools}
                  onChange={(e) => onAutoExpandChange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  <Eye className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  Show raw parameters
                </span>
                <input
                  type="checkbox"
                  checked={showRawParameters}
                  onChange={(e) => onShowRawParametersChange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                />
              </label>
            </div>
            {/* View Options */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">View Options</h4>
              
              <label className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                  <ArrowDown className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  Auto-scroll to bottom
                </span>
                <input
                  type="checkbox"
                  checked={autoScrollToBottom}
                  onChange={(e) => onAutoScrollChange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                />
              </label>
            </div>

            {/* Network Access */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Network Access</h4>
              
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
                    <Globe className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                    Enable Tunnelmole
                  </span>
                  <button
                    onClick={toggleTunnel}
                    disabled={tunnelStatus.isLoading}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      tunnelStatus.isActive ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
                    } ${tunnelStatus.isLoading ? 'opacity-50' : ''}`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        tunnelStatus.isActive ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    >
                      {tunnelStatus.isLoading && (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-600" />
                      )}
                    </span>
                  </button>
                </label>
                
                {tunnelStatus.error && (
                  <div className="mt-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
                    <XCircle className="h-3 w-3" />
                    {tunnelStatus.error}
                  </div>
                )}
                
                {tunnelStatus.isActive && tunnelStatus.url && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                      <span className="text-xs text-gray-600 dark:text-gray-400">
                        Tunnel active
                      </span>
                    </div>
                    
                    <div className="p-2 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Public URL:</p>
                      <p className="text-xs font-mono text-gray-900 dark:text-white break-all">
                        {tunnelStatus.url}
                      </p>
                    </div>
                    
                    {qrCodeUrl && (
                      <div className="flex justify-center p-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
                        <img 
                          src={qrCodeUrl} 
                          alt="QR Code for tunnel URL" 
                          className="w-40 h-40"
                        />
                      </div>
                    )}
                    
                    <div className="flex gap-2">
                      <button
                        onClick={() => copyToClipboard(tunnelStatus.url)}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        {copied ? (
                          <>
                            <CheckCircle className="h-3 w-3 text-green-600 dark:text-green-400" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy
                          </>
                        )}
                      </button>
                      
                      <button
                        onClick={shareUrl}
                        className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                      >
                        <Share2 className="h-3 w-3" />
                        Share
                      </button>
                    </div>
                  </div>
                )}
                
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Expose your local server to the internet for easy mobile access.
                </p>
              </div>
            </div>

            {/* Whisper Dictation Settings - HIDDEN */}
            <div className="space-y-2" style={{ display: 'none' }}>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Whisper Dictation</h4>
              
              <div className="space-y-2">
                <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                  <input
                    type="radio"
                    name="whisperMode"
                    value="default"
                    checked={whisperMode === 'default'}
                    onChange={() => {
                      setWhisperMode('default');
                      localStorage.setItem('whisperMode', 'default');
                      window.dispatchEvent(new Event('whisperModeChanged'));
                    }}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                      <Mic className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      Default Mode
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Direct transcription of your speech
                    </p>
                  </div>
                </label>

                <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                  <input
                    type="radio"
                    name="whisperMode"
                    value="prompt"
                    checked={whisperMode === 'prompt'}
                    onChange={() => {
                      setWhisperMode('prompt');
                      localStorage.setItem('whisperMode', 'prompt');
                      window.dispatchEvent(new Event('whisperModeChanged'));
                    }}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                      <Sparkles className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      Prompt Enhancement
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Transform rough ideas into clear, detailed AI prompts
                    </p>
                  </div>
                </label>

                <label className="flex items-start p-3 rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors border border-transparent hover:border-gray-300 dark:hover:border-gray-600">
                  <input
                    type="radio"
                    name="whisperMode"
                    value="vibe"
                    checked={whisperMode === 'vibe' || whisperMode === 'instructions' || whisperMode === 'architect'}
                    onChange={() => {
                      setWhisperMode('vibe');
                      localStorage.setItem('whisperMode', 'vibe');
                      window.dispatchEvent(new Event('whisperModeChanged'));
                    }}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
                  />
                  <div className="ml-3 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                      <FileText className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                      Vibe Mode
                    </span>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Format ideas as clear agent instructions with details
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Backdrop */}
      {localIsOpen && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 transition-opacity duration-150 ease-out"
          onClick={handleToggle}
        />
      )}
    </>
  );
};

export default QuickSettingsPanel;