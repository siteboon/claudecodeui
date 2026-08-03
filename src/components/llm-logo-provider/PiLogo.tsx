type PiLogoProps = {
  className?: string;
};

const PiLogo = ({ className = 'w-5 h-5' }: PiLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="Pi"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2.5" y="2.5" width="19" height="19" rx="4" className="fill-foreground" />
    <path
      d="M6.5 8.5h11M9 8.5v8M15 8.5v6.2c0 .9.5 1.3 1.3 1.3"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default PiLogo;
