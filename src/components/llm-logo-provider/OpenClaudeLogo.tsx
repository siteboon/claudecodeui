const OpenClaudeLogo = ({ className = 'w-5 h-5' }: { className?: string }) => {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#1a1a2e" />
      <text x="12" y="16" textAnchor="middle" fill="#4ec9b0" fontSize="11" fontFamily="monospace" fontWeight="bold">OC</text>
    </svg>
  );
};

export default OpenClaudeLogo;
