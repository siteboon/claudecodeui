import type { LucideIcon } from 'lucide-react';

type FileTreeEmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export default function FileTreeEmptyState({ icon: Icon, title, description }: FileTreeEmptyStateProps) {
  return (
    <div className="py-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h4 className="mb-1 font-medium text-foreground">{title}</h4>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

