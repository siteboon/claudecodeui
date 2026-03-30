import React from 'react';
import { useTheme } from '../../contexts/ThemeContext';
import { BASE_PATH } from '../../utils/api';

type CursorLogoProps = {
  className?: string;
};

const CursorLogo = ({ className = 'w-5 h-5' }: CursorLogoProps) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? `${BASE_PATH}/icons/cursor-white.svg` : `${BASE_PATH}/icons/cursor.svg`}
      alt="Cursor"
      className={className}
    />
  );
};

export default CursorLogo;
