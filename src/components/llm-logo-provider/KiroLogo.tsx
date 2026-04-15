interface KiroLogoProps {
  className?: string;
}

const KiroLogo = ({ className = 'w-5 h-5' }: KiroLogoProps) => {
  // TODO: replace with official Kiro icon once available at /icons/kiro-icon.svg
  // Kiro is AWS's agentic IDE built on Claude (https://kiro.dev)
  // Using AWS-inspired colors and design as a placeholder
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Kiro"
      title="Kiro"
    >
      <rect width="24" height="24" rx="4" fill="#FF9900"/>
      <text
        x="12"
        y="17"
        fill="white"
        fontSize="14"
        fontWeight="bold"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        K
      </text>
    </svg>
  );
};

export default KiroLogo;
