interface KiroLogoProps {
  className?: string;
}

const KiroLogo = ({ className = 'w-5 h-5' }: KiroLogoProps) => {
  // TODO: replace with official Kiro icon once available at /icons/kiro-icon.svg
  // Kiro is AWS's agentic IDE built on Claude (https://kiro.dev)
  // For now, render a simple "K" text badge as a fallback
  return (
    <span
      className={`inline-flex items-center justify-center rounded font-bold text-white bg-orange-500 text-xs ${className}`}
      aria-label="Kiro"
      title="Kiro"
    >
      K
    </span>
  );
};

export default KiroLogo;
