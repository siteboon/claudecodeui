import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { withBasePath } from '../../utils/basePath.js';

type CodexLogoProps = {
  className?: string;
};

const CodexLogo = ({ className = 'w-5 h-5' }: CodexLogoProps) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? withBasePath('/icons/codex-white.svg') : withBasePath('/icons/codex.svg')}
      alt="Codex"
      className={className}
    />
  );
};

export default CodexLogo;
