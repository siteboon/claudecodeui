// Audio notification service for claudecodeui
class AudioService {
  constructor() {
    this.context = null;
    this.isEnabled = true;
    this.audioUnlocked = false;
    this.settings = {
      volume: 0.7,
      rate: 1.0,
      pitch: 1.0,
      voice: null,
      fallbackToBeep: true
    };
    this.initializeAudio();
    this.setupMobileAudioUnlock();
  }

  async initializeAudio() {
    try {
      // Initialize Web Audio context for beep fallback
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      
      // Initialize speech synthesis
      if ('speechSynthesis' in window) {
        this.speechSynthesis = window.speechSynthesis;
        
        // Load voices when they become available
        if (this.speechSynthesis.getVoices().length === 0) {
          this.speechSynthesis.addEventListener('voiceschanged', () => {
            this.loadVoices();
          });
        } else {
          this.loadVoices();
        }
      }
    } catch (error) {
      console.warn('Could not initialize audio service:', error);
    }
  }

  // Setup mobile audio unlock on user interaction
  setupMobileAudioUnlock() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (isMobile) {
      console.log('📱 Setting up mobile audio unlock listeners');
      
      const unlockAudio = async (event) => {
        try {
          console.log('📱 User interaction detected, unlocking audio...');
          
          if (this.context && this.context.state === 'suspended') {
            await this.context.resume();
            console.log('🔊 Audio context resumed');
          }
          
          // Play a silent buffer to unlock audio
          if (this.context) {
            const buffer = this.context.createBuffer(1, 1, 22050);
            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.connect(this.context.destination);
            source.start();
            console.log('🔊 Silent buffer played to unlock audio');
          }
          
          // Also try to unlock speech synthesis
          if (this.speechSynthesis) {
            try {
              // Create a very short, silent utterance to unlock speech synthesis
              const silentUtterance = new SpeechSynthesisUtterance(' ');
              silentUtterance.volume = 0;
              silentUtterance.rate = 10;
              this.speechSynthesis.speak(silentUtterance);
              console.log('🎤 Speech synthesis unlocked');
            } catch (speechError) {
              console.warn('Could not unlock speech synthesis:', speechError);
            }
          }
          
          this.audioUnlocked = true;
          console.log('✅ Mobile audio fully unlocked through user interaction');
          
        } catch (error) {
          console.warn('Could not unlock mobile audio:', error);
        }
      };
      
      // Add persistent event listeners (don't remove them)
      document.addEventListener('touchstart', unlockAudio, { passive: true });
      document.addEventListener('touchend', unlockAudio, { passive: true });
      document.addEventListener('click', unlockAudio, { passive: true });
      document.addEventListener('keydown', unlockAudio, { passive: true });
      
      // Also listen for specific UI interactions that should unlock audio
      const uiSelectors = ['button', 'input', 'select', 'textarea', '[role="button"]', '[onclick]'];
      uiSelectors.forEach(selector => {
        document.addEventListener('click', (event) => {
          if (event.target.closest(selector)) {
            unlockAudio(event);
          }
        }, { passive: true });
      });
    }
  }

  loadVoices() {
    const voices = this.speechSynthesis.getVoices();
    
    // Prioritized list of natural-sounding English voices
    const preferredVoices = [
      // High-quality neural voices
      'Microsoft Aria Online (Natural) - English (United States)',
      'Microsoft Jenny Online (Natural) - English (United States)', 
      'Microsoft Guy Online (Natural) - English (United States)',
      'Microsoft Davis Online (Natural) - English (United States)',
      'Microsoft Ana Online (Natural) - English (United States)',
      
      // Google voices (often high quality)
      'Google US English',
      'Google UK English Female',
      'Google UK English Male',
      
      // System voices (macOS)
      'Samantha',
      'Alex',
      'Victoria',
      'Karen',
      'Daniel',
      
      // Microsoft standard voices  
      'Microsoft Zira',
      'Microsoft David',
      'Microsoft Mark',
      
      // Chrome/Edge voices
      'Chrome OS US English',
      'Edge Aria',
      'Edge Jenny'
    ];
    
    // Find the best available voice
    for (const voiceName of preferredVoices) {
      const voice = voices.find(v => 
        v.name.includes(voiceName) || v.name === voiceName
      );
      if (voice && voice.lang.startsWith('en')) {
        this.settings.voice = voice;
        console.log(`🎤 Selected voice: ${voice.name} (${voice.lang})`);
        break;
      }
    }
    
    // Fallback: find best English voice by language preference
    if (!this.settings.voice) {
      const englishVoices = voices.filter(v => v.lang.startsWith('en'));
      
      // Prefer US English, then UK English, then any English
      const prioritizedLangs = ['en-US', 'en-GB', 'en'];
      for (const lang of prioritizedLangs) {
        const voice = englishVoices.find(v => v.lang.startsWith(lang));
        if (voice) {
          this.settings.voice = voice;
          console.log(`🎤 Fallback voice: ${voice.name} (${voice.lang})`);
          break;
        }
      }
    }
    
    // Last resort: use first available voice
    if (!this.settings.voice && voices.length > 0) {
      this.settings.voice = voices[0];
      console.log(`🎤 Last resort voice: ${voices[0].name} (${voices[0].lang})`);
    }
  }

  async speak(text, options = {}) {
    if (!this.isEnabled) return;

    // Ensure audio context is active for mobile
    await this.ensureAudioContextActive();

    try {
      // Try speech synthesis first
      if (this.speechSynthesis && this.settings.voice) {
        await this.speakWithSynthesis(text, options);
      } else if (this.settings.fallbackToBeep) {
        // Fallback to beep notification
        this.playNotificationBeep();
      }
    } catch (error) {
      console.warn('Speech synthesis failed:', error);
      if (this.settings.fallbackToBeep) {
        this.playNotificationBeep();
      }
    }
  }

  async speakWithSynthesis(text, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        // Cancel any ongoing speech
        this.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = this.settings.voice;
        utterance.volume = options.volume || this.settings.volume;
        utterance.rate = options.rate || this.settings.rate;
        utterance.pitch = options.pitch || this.settings.pitch;

        utterance.onend = () => resolve();
        utterance.onerror = (error) => reject(error);

        this.speechSynthesis.speak(utterance);
      } catch (error) {
        reject(error);
      }
    });
  }

  playNotificationBeep(frequency = 800, duration = 200) {
    if (!this.context) return;

    try {
      const oscillator = this.context.createOscillator();
      const gainNode = this.context.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(this.context.destination);

      oscillator.frequency.setValueAtTime(frequency, this.context.currentTime);
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0, this.context.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, this.context.currentTime + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.context.currentTime + duration / 1000);

      oscillator.start(this.context.currentTime);
      oscillator.stop(this.context.currentTime + duration / 1000);
    } catch (error) {
      console.warn('Could not play notification beep:', error);
    }
  }

  // Handle audio notification from WebSocket
  async handleAudioNotification(notification) {
    if (!notification || notification.type !== 'audio-notification') return;

    const { message, messageType, voice, metadata, audioUrl, source } = notification;
    
    // Reduced console logging for audio notifications (commented out to reduce console noise)
    // console.log(`🔊 Playing audio notification: ${message}`);
    // console.log(`🎵 Audio source: ${source || 'browser-tts'}`);
    // console.log(`📱 Audio unlock status: ${this.isAudioUnlocked()}`);
    // console.log(`🔗 Audio URL provided: ${audioUrl ? 'YES' : 'NO'}`);
    // console.log(`📋 Full notification data:`, { message, messageType, audioUrl, source, metadata });
    
    // If we have a backend-generated audio URL, play that instead of browser TTS
    if (audioUrl && source === 'backend-tts') {
      try {
        // console.log(`🎵 Playing backend TTS audio: ${audioUrl}`);
        await this.playStreamedAudio(audioUrl, notification);
        // console.log(`✅ Backend TTS audio played successfully`);
        return;
      } catch (error) {
        console.warn('🔄 Backend audio failed, falling back to browser TTS:', error);
        console.error('🔄 Error details:', error);
        // Continue to browser TTS fallback below
      }
    }
    
    // Fallback to browser TTS synthesis
    // console.log('🎤 Using browser TTS synthesis');
    
    // Add contextual information based on message type
    let enhancedMessage = message;
    if (messageType === 'session_start' && metadata?.projectPath) {
      const projectName = metadata.projectPath.split('/').pop() || 'project';
      enhancedMessage = `${message} for ${projectName}`;
    }

    await this.speak(enhancedMessage, { voice });
  }

  // Check if audio context is suspended (mobile autoplay restriction)
  async ensureAudioContextActive() {
    if (this.context && this.context.state === 'suspended') {
      try {
        await this.context.resume();
        console.log('🔊 Audio context resumed for mobile playback');
      } catch (error) {
        console.warn('Could not resume audio context:', error);
      }
    }
  }

  // Check if audio is fully unlocked and ready for mobile playback
  isAudioUnlocked() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (!isMobile) {
      return true; // Desktop doesn't have autoplay restrictions for notifications
    }
    
    const contextReady = !this.context || this.context.state === 'running';
    const audioUnlocked = this.audioUnlocked;
    
    // console.log(`📱 Mobile audio status: unlocked=${audioUnlocked}, contextReady=${contextReady}`);
    
    return audioUnlocked && contextReady;
  }

  // Play streamed audio from backend TTS with mobile support
  async playStreamedAudio(audioUrl, notification = {}) {
    if (!this.isEnabled) return;

    // Ensure audio context is active for mobile
    await this.ensureAudioContextActive();

    return new Promise((resolve, reject) => {
      try {
        // Create audio element
        const audio = new Audio();
        
        // Mobile-specific settings
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        if (isMobile) {
          // Allow mobile playback
          audio.setAttribute('playsinline', 'true');
          audio.muted = false; // Ensure not muted
          console.log('📱 Mobile device detected, applying mobile audio settings');
        }
        
        // Set up event handlers
        audio.onloadstart = () => {
          console.log('🎵 Started loading backend audio...');
        };
        
        audio.oncanplay = () => {
          console.log('🎵 Backend audio ready to play');
        };
        
        audio.onended = () => {
          console.log('✅ Backend audio playback complete');
          resolve();
        };
        
        audio.onerror = (error) => {
          console.error('❌ Backend audio playback error:', error);
          console.error('Audio error details:', {
            code: audio.error?.code,
            message: audio.error?.message,
            type: error.type,
            target: error.target
          });
          reject(new Error(`Audio playback failed: ${error.message || audio.error?.message || 'Unknown error'}`));
        };
        
        audio.onabort = () => {
          console.warn('⚠️ Backend audio playback aborted');
          reject(new Error('Audio playback aborted'));
        };
        
        // Set audio properties
        audio.volume = this.settings.volume || 0.7;
        audio.preload = 'auto';
        
        // Handle CORS and authentication if needed
        audio.crossOrigin = 'anonymous';
        
        // Start loading and playing
        audio.src = audioUrl;
        
        // Mobile-friendly play attempt with retry
        const attemptPlay = async () => {
          try {
            // If audio is not unlocked on mobile, try to unlock it first
            if (isMobile && !this.audioUnlocked) {
              console.log('📱 Audio not unlocked yet, attempting unlock before playback...');
              await this.ensureAudioContextActive();
              
              // Try to unlock with a silent buffer
              try {
                if (this.context) {
                  const buffer = this.context.createBuffer(1, 1, 22050);
                  const source = this.context.createBufferSource();
                  source.buffer = buffer;
                  source.connect(this.context.destination);
                  source.start();
                  this.audioUnlocked = true;
                  console.log('🔊 Audio unlocked before playback attempt');
                }
              } catch (unlockError) {
                console.warn('Could not pre-unlock audio:', unlockError);
              }
            }
            
            const playPromise = audio.play();
            
            if (playPromise !== undefined) {
              await playPromise;
              console.log('🎵 Backend audio started playing successfully');
            }
          } catch (playError) {
            console.error('❌ Backend audio play() failed:', playError);
            
            // For mobile, try multiple fallback approaches
            if (isMobile && (playError.name === 'NotAllowedError' || playError.name === 'NotSupportedError')) {
              console.log('📱 Mobile autoplay blocked, trying fallback methods...');
              
              // First, try browser TTS as it might work better on mobile
              try {
                console.log('🔄 Falling back to browser TTS for mobile...');
                const message = notification.message || 'Notification';
                await this.speak(message);
                resolve();
                return;
              } catch (ttsError) {
                console.warn('🔄 Browser TTS also failed, trying beep fallback');
              }
              
              // Last resort: beep notification
              try {
                this.playNotificationBeep();
                console.log('🔊 Played beep notification as final fallback');
                resolve();
              } catch (beepError) {
                console.warn('🔄 Even beep notification failed:', beepError);
                resolve(); // Don't reject, just complete silently
              }
            } else {
              reject(playError);
            }
          }
        };
        
        // Start play attempt
        attemptPlay();
        
        // Cleanup function
        const cleanup = () => {
          audio.onloadstart = null;
          audio.oncanplay = null;
          audio.onended = null;
          audio.onerror = null;
          audio.onabort = null;
          audio.src = '';
        };
        
        // Set up cleanup on completion
        audio.addEventListener('ended', cleanup, { once: true });
        audio.addEventListener('error', cleanup, { once: true });
        audio.addEventListener('abort', cleanup, { once: true });
        
      } catch (error) {
        console.error('❌ Error setting up backend audio playback:', error);
        reject(error);
      }
    });
  }

  // Settings management
  setEnabled(enabled) {
    this.isEnabled = enabled;
    localStorage.setItem('audioNotifications.enabled', enabled.toString());
  }

  getEnabled() {
    const stored = localStorage.getItem('audioNotifications.enabled');
    return stored !== null ? stored === 'true' : this.isEnabled;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    localStorage.setItem('audioNotifications.settings', JSON.stringify(this.settings));
  }

  loadSettings() {
    const stored = localStorage.getItem('audioNotifications.settings');
    if (stored) {
      try {
        this.settings = { ...this.settings, ...JSON.parse(stored) };
      } catch (error) {
        console.warn('Could not load audio settings:', error);
      }
    }
    this.isEnabled = this.getEnabled();
  }

  // Test audio notification
  async testNotification() {
    // Try to test with backend TTS first
    try {
      const response = await fetch('/api/audio/test-notification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: 'Audio notifications are working correctly',
          messageType: 'test'
        })
      });
      
      if (response.ok) {
        console.log('🎵 Backend TTS test initiated');
        return; // Backend will handle the notification via WebSocket
      }
    } catch (error) {
      console.warn('🔄 Backend TTS test failed, using browser TTS:', error);
    }
    
    // Fallback to browser TTS
    await this.speak('Audio notifications are working correctly');
  }
}

// Create singleton instance
export const audioService = new AudioService();

// Load settings on initialization
audioService.loadSettings();

export default audioService;