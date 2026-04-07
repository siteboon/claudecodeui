import { BASE_PATH } from '../../utils/api';

const GeminiLogo = ({className = 'w-5 h-5'}) => {
  return (
    <img src={`${BASE_PATH}/icons/gemini-ai-icon.svg`} alt="Gemini" className={className} />
  );
};

export default GeminiLogo;