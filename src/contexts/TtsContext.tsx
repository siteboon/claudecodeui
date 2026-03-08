import { createContext, useContext, type ReactNode } from 'react';
import { useSpeechOutput } from '../hooks/useSpeechOutput';
import type { VoiceInfo } from '../hooks/useSpeechOutput';

type TtsContextValue = {
  enabled: boolean;
  toggle: () => void;
  rate: number;
  setRate: (rate: number) => void;
  pitch: number;
  setPitch: (pitch: number) => void;
  voiceURI: string;
  setVoiceURI: (uri: string) => void;
  lang: string;
  setLang: (lang: string) => void;
  isSpeaking: boolean;
  speak: (text: string) => void;
  stop: () => void;
  testVoice: () => void;
  availableVoices: VoiceInfo[];
  filteredVoices: VoiceInfo[];
  availableLanguages: string[];
};

const TtsContext = createContext<TtsContextValue | null>(null);

type ChatMessage = {
  type: string;
  content?: string;
  isStreaming?: boolean;
  isToolUse?: boolean;
  isInteractivePrompt?: boolean;
  [key: string]: unknown;
};

export function TtsProvider({
  chatMessages,
  children,
}: {
  chatMessages: ChatMessage[];
  children: ReactNode;
}) {
  const tts = useSpeechOutput(chatMessages);
  return <TtsContext.Provider value={tts}>{children}</TtsContext.Provider>;
}

export function useTts(): TtsContextValue | null {
  return useContext(TtsContext);
}
