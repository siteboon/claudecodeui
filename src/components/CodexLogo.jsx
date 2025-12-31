import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

const CodexLogo = ({ className = 'w-5 h-5' }) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? "/icons/codex-white.svg" : "/icons/codex.svg"}
      alt="Codex"
      className={className}
    />
  );
};

export default CodexLogo;
