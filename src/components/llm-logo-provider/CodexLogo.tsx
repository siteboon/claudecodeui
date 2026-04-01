import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

type CodexLogoProps = {
  className?: string;
};

const CodexLogo = ({ className = 'w-5 h-5' }: CodexLogoProps) => {
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
