import { BASE_URL } from '../utils/api';

const ClaudeLogo = ({ className = 'w-5 h-5' }) => (
  <img src={`${BASE_URL}/icons/claude-ai-icon.svg`} alt="Claude" className={className} />
);

export default ClaudeLogo;
