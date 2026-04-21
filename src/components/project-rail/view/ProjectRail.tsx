import { ScrollArea } from '../../../shared/view/ui';
import type { ProjectRailItemData } from '../types/types';
import ProjectRailAllProjects from './subcomponents/ProjectRailAllProjects';
import ProjectRailItem from './subcomponents/ProjectRailItem';

type ProjectRailProps = {
  railItems: ProjectRailItemData[];
  activeProjectFilter: string | null;
  totalAttentionCount: number;
  onProjectFilter: (projectName: string | null) => void;
};

export default function ProjectRail({
  railItems,
  activeProjectFilter,
  totalAttentionCount,
  onProjectFilter,
}: ProjectRailProps) {
  return (
    <div className="flex h-full w-rail flex-col items-center border-r border-border/50 bg-rail py-2.5">
      <ProjectRailAllProjects
        isActive={activeProjectFilter === null}
        attentionCount={totalAttentionCount}
        onClick={() => onProjectFilter(null)}
      />

      <div className="mx-auto my-1.5 h-px w-5 bg-border" />

      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-1">
          {railItems.map((item) => (
            <ProjectRailItem
              key={item.name}
              item={item}
              isActive={activeProjectFilter === item.name}
              onClick={() => onProjectFilter(item.name)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
