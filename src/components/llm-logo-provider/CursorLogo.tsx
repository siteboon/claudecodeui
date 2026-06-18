type CursorLogoProps = {
  className?: string;
};

const CursorLogo = ({ className = 'w-5 h-5' }: CursorLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="Cursor"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M11.925 24l10.425-6-10.425-6L1.5 18l10.425 6z"
      fill="currentColor"
      opacity=".39"
    />
    <path d="M22.35 18V6L11.925 0v12l10.425 6z" fill="currentColor" opacity=".8" />
    <path d="M11.925 0L1.5 6v12l10.425-6V0z" fill="currentColor" opacity=".6" />
    <path d="M22.35 6L11.925 24V12L22.35 6z" fill="currentColor" opacity=".72" />
    <path d="M22.35 6l-10.425 6L1.5 6h20.85z" fill="currentColor" opacity=".95" />
  </svg>
);

export default CursorLogo;
