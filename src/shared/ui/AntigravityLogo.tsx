type AntigravityLogoProps = {
  className?: string;
};

/**
 * Rendered by the shared LLMProviderLogo when the provider is Antigravity.
 *
 * The mark is the four-pointed "spark" Antigravity uses for its agent, drawn on
 * the provider's teal accent so it reads apart from the other four logos.
 */
const AntigravityLogo = ({ className = 'w-5 h-5' }: AntigravityLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="Antigravity"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2.5" y="2.5" width="19" height="19" rx="5" className="fill-teal-600" />
    <path
      d="M12 5.4c.35 3.05 1.6 4.4 4.6 4.75-3 .35-4.25 1.7-4.6 4.75-.35-3.05-1.6-4.4-4.6-4.75 3-.35 4.25-1.7 4.6-4.75Z"
      fill="#fff"
    />
    <path
      d="M15.9 14.2c.16 1.4.74 2.02 2.1 2.18-1.36.16-1.94.78-2.1 2.18-.16-1.4-.74-2.02-2.1-2.18 1.36-.16 1.94-.78 2.1-2.18Z"
      fill="#fff"
      fillOpacity="0.75"
    />
  </svg>
);

export default AntigravityLogo;
