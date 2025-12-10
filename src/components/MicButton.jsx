import React, { useState, useEffect, useRef } from 'react';
import { Mic, Loader2, Brain } from 'lucide-react';
import { transcribeWithWhisper } from '../utils/whisper';

export function MicButton({ onTranscript, className = '', useWebSpeech = false }) {
  const [state, setState] = useState('idle'); // idle, recording/listening, transcribing, processing
  const [error, setError] = useState(null);
  const [isSupported, setIsSupported] = useState(true);
  const [currentLang, setCurrentLang] = useState('zh-TW');

  // OpenAI Whisper refs
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  // Web Speech API refs
  const recognitionRef = useRef(null);
  const listeningTimerRef = useRef(null);
  const fallbackAttemptRef = useRef(0);

  const lastTapRef = useRef(0);

  // Check support on mount
  useEffect(() => {
    const checkSupport = () => {
      if (useWebSpeech) {
        // Check Web Speech API support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
          setIsSupported(false);
          setError('Speech recognition not supported. Please use Chrome, Edge, or Safari.');
          return;
        }

        // Initialize speech recognition
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = currentLang;
        recognition.maxAlternatives = 3;

        recognitionRef.current = recognition;
      } else {
        // Check microphone support for OpenAI Whisper
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          setIsSupported(false);
          setError('Microphone not supported. Please use HTTPS or a modern browser.');
          return;
        }
      }

      // Check secure context
      if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
        setIsSupported(false);
        setError('Microphone requires HTTPS. Please use a secure connection.');
        return;
      }

      setIsSupported(true);
      setError(null);
    };

    checkSupport();
  }, [useWebSpeech, currentLang]);

  // Web Speech API functions
  const startListeningWithLang = (lang = 'zh-TW') => {
    if (!recognitionRef.current || !isSupported) return;

    try {
      console.log(`Starting speech recognition with language: ${lang}`);
      setError(null);
      setCurrentLang(lang);

      const recognition = recognitionRef.current;
      recognition.lang = lang;

      recognition.onresult = (event) => {
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          const confidence = event.results[i][0].confidence;

          if (event.results[i].isFinal) {
            finalTranscript += transcript;
            console.log(`Final transcript (${lang}, confidence: ${confidence}):`, transcript);
          }
        }

        if (finalTranscript && onTranscript) {
          const trimmedText = finalTranscript.trim();
          if (trimmedText) {
            onTranscript(trimmedText);
            fallbackAttemptRef.current = 0;
          }
        }
      };

      recognition.onerror = (event) => {
        console.error(`Speech recognition error (${lang}):`, event.error);

        // Try fallback language on certain errors
        if ((event.error === 'no-speech' || event.error === 'language-not-supported') && fallbackAttemptRef.current === 0) {
          const fallbackLang = lang === 'zh-TW' ? 'en-US' : 'zh-TW';

          console.log(`Trying fallback language: ${fallbackLang}`);
          fallbackAttemptRef.current = 1;

          setTimeout(() => {
            setState('idle');
            startListeningWithLang(fallbackLang);
          }, 500);
          return;
        }

        let errorMessage = 'Speech recognition error';

        switch (event.error) {
          case 'no-speech':
            errorMessage = 'No speech detected, please try again';
            break;
          case 'audio-capture':
            errorMessage = 'Microphone not accessible, please check permissions';
            break;
          case 'not-allowed':
            errorMessage = 'Microphone permission denied';
            break;
          case 'network':
            errorMessage = 'Network error, please check connection';
            break;
          case 'language-not-supported':
            errorMessage = `Language ${lang} not supported, trying another`;
            break;
          default:
            errorMessage = `Speech recognition failed: ${event.error}`;
        }

        setError(errorMessage);
        setState('idle');
        fallbackAttemptRef.current = 0;
      };

      recognition.onend = () => {
        console.log('Speech recognition ended');
        setState('idle');

        if (listeningTimerRef.current) {
          clearTimeout(listeningTimerRef.current);
          listeningTimerRef.current = null;
        }
      };

      recognition.start();
      setState('listening');

      listeningTimerRef.current = setTimeout(() => {
        console.log('Auto-stopping speech recognition after 60 seconds');
        stopListening();
      }, 60000);

    } catch (err) {
      console.error('Failed to start speech recognition:', err);
      setError('Failed to start speech recognition');
      setState('idle');
    }
  };

  const startListening = () => {
    fallbackAttemptRef.current = 0;
    startListeningWithLang(currentLang);
  };

  const stopListening = () => {
    if (!recognitionRef.current) return;

    try {
      console.log('Stopping speech recognition...');
      recognitionRef.current.stop();

      if (listeningTimerRef.current) {
        clearTimeout(listeningTimerRef.current);
        listeningTimerRef.current = null;
      }

    } catch (err) {
      console.error('Error stopping speech recognition:', err);
    }

    setState('idle');
  };

  // OpenAI Whisper functions
  const startRecording = async () => {
    try {
      console.log('Starting recording...');
      setError(null);
      chunksRef.current = [];

      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Microphone access not available. Please use HTTPS or a supported browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        console.log('Recording stopped, creating blob...');
        const blob = new Blob(chunksRef.current, { type: mimeType });

        // Clean up stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(track => track.stop());
          streamRef.current = null;
        }

        // Start transcribing
        setState('transcribing');

        // Check if we're in an enhancement mode
        const whisperMode = window.localStorage.getItem('whisperMode') || 'default';
        const isEnhancementMode = whisperMode === 'prompt' || whisperMode === 'vibe' || whisperMode === 'instructions' || whisperMode === 'architect';

        // Set up a timer to switch to processing state for enhancement modes
        let processingTimer;
        if (isEnhancementMode) {
          processingTimer = setTimeout(() => {
            setState('processing');
          }, 2000); // Switch to processing after 2 seconds
        }

        try {
          const text = await transcribeWithWhisper(blob);
          if (text && onTranscript) {
            onTranscript(text);
          }
        } catch (err) {
          console.error('Transcription error:', err);
          setError(err.message);
        } finally {
          if (processingTimer) {
            clearTimeout(processingTimer);
          }
          setState('idle');
        }
      };

      recorder.start();
      setState('recording');
      console.log('Recording started successfully');

      recordingTimerRef.current = setTimeout(() => {
        console.log('Auto-stopping recording after 60 seconds');
        stopRecording();
      }, 60000);
    } catch (err) {
      console.error('Failed to start recording:', err);

      // Provide specific error messages based on error type
      let errorMessage = 'Microphone access failed';

      if (err.name === 'NotAllowedError') {
        errorMessage = 'Microphone access denied. Please allow microphone permissions.';
      } else if (err.name === 'NotFoundError') {
        errorMessage = 'No microphone found. Please check your audio devices.';
      } else if (err.name === 'NotSupportedError') {
        errorMessage = 'Microphone not supported by this browser.';
      } else if (err.name === 'NotReadableError') {
        errorMessage = 'Microphone is being used by another application.';
      } else if (err.message.includes('HTTPS')) {
        errorMessage = err.message;
      }

      setError(errorMessage);
      setState('idle');
    }
  };

  // Stop recording
  const stopRecording = () => {
    console.log('Stopping recording...');

    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      // Don't set state here - let the onstop handler do it
    } else {
      // If recorder isn't in recording state, force cleanup
      console.log('Recorder not in recording state, forcing cleanup');
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      setState('idle');
    }
  };

  // Handle button click
  const handleClick = (e) => {
    // Prevent double firing on mobile
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // Don't proceed if microphone is not supported
    if (!isSupported) {
      return;
    }

    // Debounce for mobile double-tap issue
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      console.log('Ignoring rapid tap');
      return;
    }
    lastTapRef.current = now;

    console.log('Button clicked, current state:', state, 'mode:', useWebSpeech ? 'WebSpeech' : 'OpenAI');

    if (state === 'idle') {
      if (useWebSpeech) {
        startListening();
      } else {
        startRecording();
      }
    } else if (state === 'listening') {
      stopListening();
    } else if (state === 'recording') {
      stopRecording();
    }
    // Do nothing if transcribing or processing
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (err) {
          console.error('Error stopping recognition on unmount:', err);
        }
      }
      if (recordingTimerRef.current) {
        clearTimeout(recordingTimerRef.current);
      }
      if (listeningTimerRef.current) {
        clearTimeout(listeningTimerRef.current);
      }
    };
  }, []);

  // Button appearance based on state
  const getButtonAppearance = () => {
    if (!isSupported) {
      return {
        icon: <Mic className="w-5 h-5" />,
        className: 'bg-gray-400 cursor-not-allowed',
        disabled: true
      };
    }

    switch (state) {
      case 'listening':
        return {
          icon: <Mic className="w-5 h-5 text-white" />,
          className: 'bg-green-500 hover:bg-green-600 animate-pulse',
          disabled: false
        };
      case 'recording':
        return {
          icon: <Mic className="w-5 h-5 text-white" />,
          className: 'bg-red-500 hover:bg-red-600 animate-pulse',
          disabled: false
        };
      case 'transcribing':
        return {
          icon: <Loader2 className="w-5 h-5 animate-spin" />,
          className: 'bg-blue-500 hover:bg-blue-600',
          disabled: true
        };
      case 'processing':
        return {
          icon: <Brain className="w-5 h-5 animate-pulse" />,
          className: 'bg-purple-500 hover:bg-purple-600',
          disabled: true
        };
      default: // idle
        return {
          icon: <Mic className="w-5 h-5" />,
          className: 'bg-gray-700 hover:bg-gray-600',
          disabled: false
        };
    }
  };

  const { icon, className: buttonClass, disabled } = getButtonAppearance();

  return (
    <div className="relative">
      <button
        type="button"
        style={{
          backgroundColor: state === 'listening' ? '#22c55e' :
                          state === 'recording' ? '#ef4444' :
                          state === 'transcribing' ? '#3b82f6' :
                          state === 'processing' ? '#a855f7' :
                          '#374151'
        }}
        className={`
          flex items-center justify-center
          w-12 h-12 rounded-full
          text-white transition-all duration-200
          focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500
          dark:ring-offset-gray-800
          touch-action-manipulation
          ${disabled ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}
          ${(state === 'listening' || state === 'recording') ? 'animate-pulse' : ''}
          hover:opacity-90
          ${className}
        `}
        onClick={handleClick}
        disabled={disabled}
      >
        {icon}
      </button>

      {error && (
        <div className="absolute top-full mt-2 left-1/2 transform -translate-x-1/2
                        bg-red-500 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10
                        animate-fade-in">
          {error}
        </div>
      )}

      {(state === 'listening' || state === 'recording') && (
        <div className="absolute -top-8 left-1/2 transform -translate-x-1/2
                        bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
          {useWebSpeech ?
            (currentLang === 'zh-TW' ? 'TW' : 'EN') :
            'OpenAI'
          }
        </div>
      )}

      {state === 'listening' && (
        <div className="absolute -inset-1 rounded-full border-2 border-green-500 animate-ping pointer-events-none" />
      )}

      {state === 'recording' && (
        <div className="absolute -inset-1 rounded-full border-2 border-red-500 animate-ping pointer-events-none" />
      )}

      {state === 'processing' && (
        <div className="absolute -inset-1 rounded-full border-2 border-purple-500 animate-ping pointer-events-none" />
      )}
    </div>
  );
}
