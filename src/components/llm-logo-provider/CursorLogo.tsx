import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';

type CursorLogoProps = {
  className?: string;
};

const CursorLogo = ({ className = 'w-5 h-5' }: CursorLogoProps) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? `${window.__ROUTER_BASENAME__ || ''}/icons/cursor-white.svg` : `${window.__ROUTER_BASENAME__ || ''}/icons/cursor.svg`}
      alt="Cursor"
      className={className}
    />
  );
};

export default CursorLogo;
