type PiLogoProps = {
  className?: string;
};

/**
 * Rendered by the shared LLMProviderLogo when the provider is Pi.
 *
 * Draws a terminal prompt (`>_`) on the same filled tile the other agent logos
 * use. The glyph is sized so it carries the same visual weight as OpenCode's
 * brackets inside the tile, and the stroke width and caps match the sibling
 * logos so the five marks read as one family at 16-24px.
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
      d="M5.9 7.6 11.2 12 5.9 16.4"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.5 16.4h4.6"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  </svg>
);

export default PiLogo;
