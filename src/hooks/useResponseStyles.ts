import { useState, useMemo } from 'react';

export type ResponseStyle = 'concise' | 'normal' | 'detailed';

const STYLE_SUFFIXES: Record<ResponseStyle, string> = {
  concise: 'Be concise and brief in your responses. Avoid unnecessary elaboration.',
  normal: '',
  detailed: 'Be thorough and detailed in your responses. Provide comprehensive explanations.',
};

const AVAILABLE_STYLES: ResponseStyle[] = ['concise', 'normal', 'detailed'];

export function useResponseStyles() {
  const [style, setStyleState] = useState<ResponseStyle>(() => {
    const stored = localStorage.getItem('response-style') as ResponseStyle | null;
    return stored && AVAILABLE_STYLES.includes(stored) ? stored : 'normal';
  });

  const setStyle = (newStyle: ResponseStyle) => {
    setStyleState(newStyle);
    localStorage.setItem('response-style', newStyle);
  };

  const systemPromptSuffix = useMemo(() => STYLE_SUFFIXES[style], [style]);

  return {
    style,
    setStyle,
    systemPromptSuffix,
    availableStyles: AVAILABLE_STYLES,
  };
}
