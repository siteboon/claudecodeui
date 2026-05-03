interface SkipLinkProps {
  targetId: string;
  label?: string;
}

export default function SkipLink({ targetId, label = 'Skip to content' }: SkipLinkProps) {
  return (
    <a
      href={`#${targetId}`}
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[99999] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground focus:shadow-lg"
    >
      {label}
    </a>
  );
}
