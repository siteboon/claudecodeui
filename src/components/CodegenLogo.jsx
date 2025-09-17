import React from 'react';

const CodegenLogo = ({ className = "w-8 h-8" }) => {
  return (
    <svg 
      className={className} 
      viewBox="0 0 24 24" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Codegen logo - stylized code brackets with AI elements */}
      <defs>
        <linearGradient id="codegenGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10B981" />
          <stop offset="50%" stopColor="#059669" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
      </defs>
      
      {/* Left bracket */}
      <path
        d="M8 6L2 12L8 18"
        stroke="url(#codegenGradient)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* Right bracket */}
      <path
        d="M16 6L22 12L16 18"
        stroke="url(#codegenGradient)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      
      {/* AI brain/neural network pattern in center */}
      <circle
        cx="12"
        cy="8"
        r="1.5"
        fill="url(#codegenGradient)"
      />
      <circle
        cx="10"
        cy="12"
        r="1"
        fill="url(#codegenGradient)"
      />
      <circle
        cx="14"
        cy="12"
        r="1"
        fill="url(#codegenGradient)"
      />
      <circle
        cx="12"
        cy="16"
        r="1.5"
        fill="url(#codegenGradient)"
      />
      
      {/* Connection lines */}
      <path
        d="M12 9.5L10.5 11M12 9.5L13.5 11M10.5 13L12 14.5M13.5 13L12 14.5"
        stroke="url(#codegenGradient)"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.7"
      />
    </svg>
  );
};

export default CodegenLogo;
