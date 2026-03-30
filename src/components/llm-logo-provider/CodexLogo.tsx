import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { BASE_PATH } from '../../utils/api';

type CodexLogoProps = {
  className?: string;
};

const CodexLogo = ({ className = 'w-5 h-5' }: CodexLogoProps) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? `${BASE_PATH}/icons/codex-white.svg` : `${BASE_PATH}/icons/codex.svg`}
      alt="Codex"
      className={className}
    />
  );
};

export default CodexLogo;
