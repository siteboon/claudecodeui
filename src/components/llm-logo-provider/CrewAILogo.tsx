const CrewAILogo = ({ className = 'w-5 h-5' }: { className?: string }) => {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="24" height="24" rx="4" fill="#2d1b69" />
      <text x="12" y="16" textAnchor="middle" fill="#a78bfa" fontSize="9" fontFamily="monospace" fontWeight="bold">CA</text>
    </svg>
  );
};

export default CrewAILogo;
