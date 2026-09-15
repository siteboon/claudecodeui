type AntigravityLogoProps = {
  className?: string;
};

const AntigravityLogo = ({ className = 'w-5 h-5' }: AntigravityLogoProps) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label="Antigravity"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 2L14.5 8.5L21 11L14.5 13.5L12 20L9.5 13.5L3 11L9.5 8.5L12 2Z"
      className="fill-current text-primary"
    />
    <path
      d="M19 16L20.2 18.8L23 20L20.2 21.2L19 24L17.8 21.2L15 20L17.8 18.8L19 16Z"
      className="fill-current text-primary opacity-70"
    />
  </svg>
);

export default AntigravityLogo;
