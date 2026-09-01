type OmpLogoProps = {
  className?: string;
};

/** Rendered by LLMProviderLogo when the provider is OMP. */
const OmpLogo = ({ className = 'w-5 h-5' }: OmpLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="omp"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2.5" y="2.5" width="19" height="19" rx="4" className="fill-foreground" />
    <path
      d="M6.5 8.7h11M9.3 8.7v8.1M14.7 8.7v6.1c0 1.2.7 2 2 1.9"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default OmpLogo;
