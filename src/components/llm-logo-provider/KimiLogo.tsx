const KimiLogo = ({className = 'w-5 h-5'}) => {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" fill="#1A1A2E" />
      <path
        d="M8 8.5C8 8.5 10 11 12 11C14 11 16 8.5 16 8.5"
        stroke="#00D4FF"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="9.5" cy="10.5" r="1" fill="#00D4FF" />
      <circle cx="14.5" cy="10.5" r="1" fill="#00D4FF" />
      <path
        d="M9 15C9 15 10.5 16.5 12 16.5C13.5 16.5 15 15 15 15"
        stroke="#00D4FF"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default KimiLogo;
