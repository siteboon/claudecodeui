type AntigravityLogoProps = {
  className?: string;
};

export default function AntigravityLogo({ className = 'w-5 h-5' }: AntigravityLogoProps) {
  return (
    <div className={`${className} flex items-center justify-center rounded-sm bg-emerald-600 text-[9px] font-semibold leading-none text-white`}>
      A
    </div>
  );
}
