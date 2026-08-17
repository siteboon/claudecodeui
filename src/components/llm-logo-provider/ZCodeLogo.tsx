type ZCodeLogoProps = {
  className?: string;
};

const ZCodeLogo = ({ className = 'w-5 h-5' }: ZCodeLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="ZCode"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2.5" y="2.5" width="19" height="19" rx="4" className="fill-foreground" />
    <path
      d="M8 7.6h8L8 16.4h8"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default ZCodeLogo;
