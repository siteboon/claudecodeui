import { useTheme } from '@/shared/context/ThemeContext';

type KiroLogoProps = {
  className?: string;
};

const KiroLogo = ({ className = 'w-5 h-5' }: KiroLogoProps) => {
  const { isDarkMode } = useTheme();

  return (
    <img
      src={isDarkMode ? '/icons/kiro-white.svg' : '/icons/kiro.svg'}
      alt="Kiro"
      className={className}
    />
  );
};

export default KiroLogo;
