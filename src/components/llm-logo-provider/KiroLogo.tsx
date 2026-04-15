interface KiroLogoProps {
  className?: string;
}

const KiroLogo = ({ className = 'w-5 h-5' }: KiroLogoProps) => {
  // Official Kiro icon from https://kiro.dev
  // Kiro is AWS's agentic IDE built on Claude
  return (
    <img
      src={`${window.__ROUTER_BASENAME__ || ''}/icons/kiro-icon.svg`}
      alt="Kiro"
      className={className}
    />
  );
};

export default KiroLogo;
