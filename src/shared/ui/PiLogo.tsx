type PiLogoProps = {
  className?: string;
};

/**
 * Rendered by the shared LLMProviderLogo when the provider is Pi.
 *
 * Draws a terminal prompt (`>_`) on the same filled tile the other agent
 * logos use, so it reads as a CLI tool at 16-24px.
 */
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
      d="M6.6 8.4 10.3 12l-3.7 3.6"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.2 15.6h4.2"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  </svg>
);

export default PiLogo;
