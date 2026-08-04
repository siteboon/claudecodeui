type QoderLogoProps = {
  className?: string;
};

const QoderLogo = ({ className = 'w-5 h-5' }: QoderLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="Qoder"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2.5" y="2.5" width="19" height="19" rx="4" className="fill-foreground" />
    <circle
      cx="9.6"
      cy="13.9"
      r="3.5"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
    <path
      d="M12.3 11.9 16.6 7.6M13.9 15.4l2.7 2.7"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default QoderLogo;
