type HermesLogoProps = {
  className?: string;
};

export default function HermesLogo({ className = 'w-5 h-5' }: HermesLogoProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" role="img" aria-label="Hermes">
      <rect width="24" height="24" rx="6" fill="#047857" />
      <path
        d="M6.2 6.5h2.4v4.3h6.8V6.5h2.4v11h-2.4v-4.6H8.6v4.6H6.2v-11Z"
        fill="white"
      />
      <path d="M9.3 4.7h5.4l-1.2 1.2h-3L9.3 4.7Z" fill="#A7F3D0" />
    </svg>
  );
}
