import { assetUrl } from '../../utils/basePath';

const GeminiLogo = ({className = 'w-5 h-5'}) => {
  return (
    <img src={assetUrl('/icons/gemini-ai-icon.svg')} alt="Gemini" className={className} />
  );
};

export default GeminiLogo;