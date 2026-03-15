import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

type CopilotLogoProps = {
  className?: string;
};

const CopilotLogo = ({ className = 'w-5 h-5' }: CopilotLogoProps) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? "/icons/copilot-white.svg" : "/icons/copilot.svg"}
      alt="Copilot"
      className={className}
    />
  );
};

export default CopilotLogo;
