import { BASE_URL } from '../utils/api';

const CursorLogo = ({ className = 'w-5 h-5' }) => (
  <img src={`${BASE_URL}/icons/cursor.svg`} alt="Cursor" className={className} />
);

export default CursorLogo;
