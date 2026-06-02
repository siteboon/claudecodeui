import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { assetUrl } from '../../utils/basePath';

type CodexLogoProps = {
  className?: string;
};

const CodexLogo = ({ className = 'w-5 h-5' }: CodexLogoProps) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? assetUrl("/icons/codex-white.svg") : assetUrl("/icons/codex.svg")}
      alt="Codex"
      className={className}
    />
  );
};

export default CodexLogo;
