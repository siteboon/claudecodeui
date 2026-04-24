import React from 'react';
import { withBasePath } from '../../utils/basePath.js';

type ClaudeLogoProps = {
  className?: string;
};

const ClaudeLogo = ({ className = 'w-5 h-5' }: ClaudeLogoProps) => {
  return (
    <img src={withBasePath('/icons/claude-ai-icon.svg')} alt="Claude" className={className} />
  );
};

export default ClaudeLogo;

