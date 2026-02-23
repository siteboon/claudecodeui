import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

const CodexLogo = ({ className = 'w-5 h-5' }) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? `${window.__ROUTER_BASENAME__ || ''}/icons/codex-white.svg` : `${window.__ROUTER_BASENAME__ || ''}/icons/codex.svg`}
      alt="Codex"
      className={className}
    />
  );
};

export default CodexLogo;
