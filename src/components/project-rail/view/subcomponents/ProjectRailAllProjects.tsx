import { MessageSquare } from 'lucide-react';
import { Tooltip } from '../../../../shared/view/ui';

type ProjectRailAllProjectsProps = {
  isActive: boolean;
  attentionCount: number;
  onClick: () => void;
};

export default function ProjectRailAllProjects({
  isActive,
  attentionCount,
  onClick,
}: ProjectRailAllProjectsProps) {
  return (
    <Tooltip content="All projects" position="right">
      <div className="relative">
        {isActive && (
          <div className="absolute -left-[10px] top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-sm bg-rail-marker" />
        )}
        <button
          onClick={onClick}
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            isActive ? 'bg-accent' : 'hover:bg-accent/50'
          }`}
        >
          <MessageSquare className="h-4 w-4 text-foreground" strokeWidth={1.8} />
        </button>
        {attentionCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-rail bg-attention px-0.5 text-[9px] font-bold leading-none text-attention-foreground">
            {attentionCount}
          </span>
        )}
      </div>
    </Tooltip>
  );
}
