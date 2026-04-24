import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { withBasePath } from '../../utils/basePath.js';

type CursorLogoProps = {
  className?: string;
};

const CursorLogo = ({ className = 'w-5 h-5' }: CursorLogoProps) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? withBasePath('/icons/cursor-white.svg') : withBasePath('/icons/cursor.svg')}
      alt="Cursor"
      className={className}
    />
  );
};

export default CursorLogo;
