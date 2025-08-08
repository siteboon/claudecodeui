import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { Switch } from './ui/switch';

function DarkModeToggle() {
  const { isDarkMode, toggleDarkMode } = useTheme();

  return (
    <Switch
      checked={isDarkMode}
      onCheckedChange={toggleDarkMode}
      aria-label="Toggle dark mode"
    />
  );
}

export default DarkModeToggle;