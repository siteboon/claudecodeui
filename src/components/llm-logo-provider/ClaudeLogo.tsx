import React from 'react';
import { BASE_PATH } from '../../utils/api';

type ClaudeLogoProps = {
  className?: string;
};

const ClaudeLogo = ({ className = 'w-5 h-5' }: ClaudeLogoProps) => {
  return (
    <img src={`${BASE_PATH}/icons/claude-ai-icon.svg`} alt="Claude" className={className} />
  );
};

export default ClaudeLogo;


