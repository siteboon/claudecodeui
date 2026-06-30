type HermesLogoProps = {
  className?: string;
};

export default function HermesLogo({ className = 'w-5 h-5' }: HermesLogoProps) {
  return (
    <img
      className={`${className} block object-contain`}
      src="/icons/hermes-agent.png"
      alt="Hermes"
      loading="lazy"
    />
  );
}
