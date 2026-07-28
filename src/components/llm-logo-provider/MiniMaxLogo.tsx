type MiniMaxLogoProps = {
  className?: string;
};

const MiniMaxLogo = ({ className = 'w-5 h-5' }: MiniMaxLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="MiniMax"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2.5" y="2.5" width="19" height="19" rx="5" className="fill-foreground" />
    <path
      d="M6.5 16.5V7.8l5.5 5.1 5.5-5.1v8.7"
      className="stroke-background"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default MiniMaxLogo;
