import React from 'react';

type ClaudeLogoProps = {
  className?: string;
};

const ClaudeLogo = ({ className = 'w-5 h-5' }: ClaudeLogoProps) => {
  return (
    <img src="/icons/claude-ai-icon.svg" alt="Claude" className={className} />
  );
};

export default ClaudeLogo;


