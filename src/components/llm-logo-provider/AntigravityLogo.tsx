type AntigravityLogoProps = {
  className?: string;
};

export default function AntigravityLogo({ className = 'w-5 h-5' }: AntigravityLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label="Antigravity"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2" y="2" width="20" height="20" rx="5" fill="#F8FAFC" />
      <path
        d="M12 4.2a7.8 7.8 0 0 0 0 15.6v-3.2a4.6 4.6 0 0 1 0-9.2V4.2Z"
        fill="#4285F4"
      />
      <path
        d="M12 4.2a7.78 7.78 0 0 1 5.52 2.28l-2.26 2.26A4.55 4.55 0 0 0 12 7.4V4.2Z"
        fill="#34A853"
      />
      <path
        d="M19.8 12a7.77 7.77 0 0 1-2.28 5.52l-2.26-2.26A4.55 4.55 0 0 0 16.6 12h3.2Z"
        fill="#FBBC04"
      />
      <path
        d="M17.52 17.52A7.78 7.78 0 0 1 12 19.8v-3.2a4.55 4.55 0 0 0 3.26-1.34l2.26 2.26Z"
        fill="#EA4335"
      />
      <path
        d="M12 8.7 13.05 11H15.5l-1.98 1.47.76 2.33L12 13.36 9.72 14.8l.76-2.33L8.5 11h2.45L12 8.7Z"
        fill="#111827"
      />
    </svg>
  );
}
