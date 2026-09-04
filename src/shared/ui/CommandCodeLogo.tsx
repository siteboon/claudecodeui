type CommandCodeLogoProps = {
  className?: string;
};

/** Rendered by the shared LLMProviderLogo when the provider is Command Code. */
const CommandCodeLogo = ({ className = 'w-5 h-5' }: CommandCodeLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="Command Code"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M4 7l5 5-5 5M11 19h9"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default CommandCodeLogo;
