type AntigravityLogoProps = {
  className?: string;
};

export default function AntigravityLogo({ className = 'w-5 h-5' }: AntigravityLogoProps) {
  return (
    <svg
      viewBox="0 0 200 184"
      role="img"
      aria-label="Antigravity"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M100 0C118 0 132 10 140 26C152 49 160 84 168 122C176 153 187 170 198 182C199 183 200 184 198 184C191 184 186 182 180 176C157 154 140 131 126 110C119 100 111 96 100 96C89 96 81 100 74 110C60 131 43 154 20 176C14 182 9 184 2 184C0 184 1 183 2 182C13 170 24 153 32 122C40 84 48 49 60 26C68 10 82 0 100 0Z"
        fill="url(#antigravity-gradient)"
      />
      <defs>
        <linearGradient
          id="antigravity-gradient"
          x1="100"
          y1="0"
          x2="100"
          y2="184"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.02" stopColor="#FF5A36" />
          <stop offset="0.22" stopColor="#FFB800" />
          <stop offset="0.42" stopColor="#7ED957" />
          <stop offset="0.64" stopColor="#46D7D1" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
    </svg>
  );
}
