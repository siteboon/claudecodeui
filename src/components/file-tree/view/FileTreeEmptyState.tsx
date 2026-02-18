import type { LucideIcon } from 'lucide-react';

type FileTreeEmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
};

export default function FileTreeEmptyState({ icon: Icon, title, description }: FileTreeEmptyStateProps) {
  return (
    <div className="text-center py-8">
      <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-3">
        <Icon className="w-6 h-6 text-muted-foreground" />
      </div>
      <h4 className="font-medium text-foreground mb-1">{title}</h4>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

