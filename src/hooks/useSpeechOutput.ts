import { useCallback, useEffect, useRef, useState } from 'react';

type ChatMessage = {
  type: string;
  content?: string;
  isStreaming?: boolean;
  isToolUse?: boolean;
  isInteractivePrompt?: boolean;
  [key: string]: unknown;
};

export type VoiceInfo = {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
};

const STORAGE_KEY = 'tts_enabled';
const RATE_STORAGE_KEY = 'tts_rate';
const PITCH_STORAGE_KEY = 'tts_pitch';
const VOICE_STORAGE_KEY = 'tts_voice_uri';
const LANG_STORAGE_KEY = 'tts_lang';

/**
 * Strip markdown formatting for cleaner TTS output.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function readStorageFloat(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    const parsed = parseFloat(v);
    return Number.isNaN(parsed) ? fallback : parsed;
  } catch {
    return fallback;
  }
}

/**
 * Hook that speaks finalized assistant messages using the Web Speech API.
 *
 * Features:
 * - Voice selection from available system voices
 * - Adjustable rate and pitch
 * - Language filter for voice list
 * - All settings persisted in localStorage
 */
export function useSpeechOutput(chatMessages: ChatMessage[]) {
  const [enabled, setEnabled] = useState(() => readStorage(STORAGE_KEY, 'false') === 'true');
  const [rate, setRate] = useState(() => readStorageFloat(RATE_STORAGE_KEY, 1.2));
  const [pitch, setPitch] = useState(() => readStorageFloat(PITCH_STORAGE_KEY, 1.0));
  const [voiceURI, setVoiceURI] = useState(() => readStorage(VOICE_STORAGE_KEY, ''));
  const [lang, setLang] = useState(() => {
    const stored = readStorage(LANG_STORAGE_KEY, '');
    return stored || (typeof navigator !== 'undefined' ? navigator.language : 'ja-JP');
  });
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<VoiceInfo[]>([]);

  // Seed to current tail so we don't replay historical messages on mount
  const lastSpokenIndexRef = useRef(chatMessages.length - 1);
  const lastStreamingContentRef = useRef<string | null>(null);
  const chatMessagesLengthRef = useRef(chatMessages.length);
  chatMessagesLengthRef.current = chatMessages.length;

  // Load available voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      setAvailableVoices(
        voices.map((v) => ({
          name: v.name,
          lang: v.lang,
          localService: v.localService,
          voiceURI: v.voiceURI,
        })),
      );
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  // Persist settings
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* noop */ }
  }, [enabled]);
  useEffect(() => {
    try { localStorage.setItem(RATE_STORAGE_KEY, String(rate)); } catch { /* noop */ }
  }, [rate]);
  useEffect(() => {
    try { localStorage.setItem(PITCH_STORAGE_KEY, String(pitch)); } catch { /* noop */ }
  }, [pitch]);
  useEffect(() => {
    try { localStorage.setItem(VOICE_STORAGE_KEY, voiceURI); } catch { /* noop */ }
  }, [voiceURI]);
  useEffect(() => {
    try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch { /* noop */ }
  }, [lang]);

  // Monitor speechSynthesis state
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const interval = setInterval(() => {
      setIsSpeaking(window.speechSynthesis.speaking);
    }, 200);
    return () => clearInterval(interval);
  }, []);

  // Get voices filtered by current language
  const filteredVoices = availableVoices.filter((v) => {
    if (lang === '') return true;
    const langPrefix = lang.split('-')[0];
    return v.lang.startsWith(langPrefix);
  });

  // Get unique language list from all voices
  const availableLanguages = Array.from(
    new Set(availableVoices.map((v) => v.lang)),
  ).sort();

  const speak = useCallback(
    (text: string) => {
      if (!text || typeof window === 'undefined' || !window.speechSynthesis) return;

      const cleaned = stripMarkdown(text);
      if (!cleaned) return;

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.lang = lang || (typeof navigator !== 'undefined' ? navigator.language : 'ja-JP');
      utterance.rate = rate;
      utterance.pitch = pitch;

      // Find selected voice, or fall back to first matching voice
      const voices = window.speechSynthesis.getVoices();
      if (voiceURI) {
        const selected = voices.find((v) => v.voiceURI === voiceURI);
        if (selected) utterance.voice = selected;
      } else {
        const fallbackLang = lang || (typeof navigator !== 'undefined' ? navigator.language : 'ja-JP');
        const langPrefix = fallbackLang.split('-')[0];
        const fallback = voices.find((v) => v.lang.startsWith(langPrefix));
        if (fallback) utterance.voice = fallback;
      }

      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
    },
    [lang, rate, pitch, voiceURI],
  );

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, []);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (next) {
        // Seed so we only speak messages appended after enabling
        lastSpokenIndexRef.current = chatMessagesLengthRef.current - 1;
        lastStreamingContentRef.current = null;
      } else if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      }
      return next;
    });
  }, []);

  // Cancel active speech when provider unmounts
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Test current voice settings
  const testVoice = useCallback(() => {
    speak('テスト音声です。Hello, this is a test.');
  }, [speak]);

  // Watch for finalized assistant messages
  useEffect(() => {
    if (!enabled || chatMessages.length === 0) {
      return;
    }

    const lastIndex = chatMessages.length - 1;
    const lastMsg = chatMessages[lastIndex];

    if (
      !lastMsg ||
      lastMsg.type !== 'assistant' ||
      lastMsg.isToolUse ||
      lastMsg.isInteractivePrompt ||
      !lastMsg.content
    ) {
      lastStreamingContentRef.current = null;
      return;
    }

    if (lastMsg.isStreaming) {
      lastStreamingContentRef.current = lastMsg.content;
      return;
    }

    if (lastIndex > lastSpokenIndexRef.current) {
      lastSpokenIndexRef.current = lastIndex;
      lastStreamingContentRef.current = null;
      speak(lastMsg.content);
    }
  }, [chatMessages, enabled, speak]);

  // Reset spoken index when messages are cleared (new session)
  useEffect(() => {
    if (chatMessages.length === 0) {
      lastSpokenIndexRef.current = -1;
      lastStreamingContentRef.current = null;
    }
  }, [chatMessages.length]);

  return {
    enabled,
    toggle,
    rate,
    setRate,
    pitch,
    setPitch,
    voiceURI,
    setVoiceURI,
    lang,
    setLang,
    isSpeaking,
    speak,
    stop,
    testVoice,
    availableVoices,
    filteredVoices,
    availableLanguages,
  };
}
