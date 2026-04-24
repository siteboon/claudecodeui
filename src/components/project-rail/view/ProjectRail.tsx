import { useMemo, useState } from 'react';
import { Archive, Plus } from 'lucide-react';
import { ScrollArea, Tooltip } from '../../../shared/view/ui';
import type { ProjectRailItemData } from '../types/types';
import type { ProjectColorKey } from '../utils/projectColors';
import ProjectRailAllProjects from './subcomponents/ProjectRailAllProjects';
import ProjectRailItem from './subcomponents/ProjectRailItem';
import ProjectColorPicker from './subcomponents/ProjectColorPicker';

type PickerState = {
  projectName: string;
  displayName: string;
  hasIcon: boolean;
  rect: DOMRect;
};

type ProjectRailProps = {
  railItems: ProjectRailItemData[];
  activeProjectFilter: string | null;
  totalAttentionCount: number;
  onProjectFilter: (projectName: string | null) => void;
  getColor: (projectName: string | null | undefined) => ProjectColorKey;
  setColor: (projectName: string, key: ProjectColorKey) => void;
  isProjectArchived: (projectName: string) => boolean;
  onToggleArchivedProject: (projectName: string) => void;
  onCreateProject: () => void;
  onIconChanged: () => void;
};

export default function ProjectRail({
  railItems,
  activeProjectFilter,
  totalAttentionCount,
  onProjectFilter,
  getColor,
  setColor,
  isProjectArchived,
  onToggleArchivedProject,
  onCreateProject,
  onIconChanged,
}: ProjectRailProps) {
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { visibleItems, archivedCount } = useMemo(() => {
    let archivedTotal = 0;
    const visible: ProjectRailItemData[] = [];
    for (const item of railItems) {
      if (isProjectArchived(item.name)) {
        archivedTotal++;
        if (showArchived) visible.push(item);
      } else {
        visible.push(item);
      }
    }
    return { visibleItems: visible, archivedCount: archivedTotal };
  }, [railItems, isProjectArchived, showArchived]);

  return (
    <>
      <div className="flex h-full w-rail flex-col items-center border-r border-border/50 bg-rail py-2.5">
        <ProjectRailAllProjects
          isActive={activeProjectFilter === null}
          attentionCount={totalAttentionCount}
          onClick={() => onProjectFilter(null)}
        />

        <div className="mx-auto my-1.5 h-px w-5 bg-border" />

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="flex flex-col items-center gap-1">
            {visibleItems.map((item) => (
              <ProjectRailItem
                key={item.name}
                item={item}
                isActive={activeProjectFilter === item.name}
                isArchived={isProjectArchived(item.name)}
                colorKey={getColor(item.name)}
                onClick={() => onProjectFilter(item.name)}
                onRequestPicker={(rect) =>
                  setPicker({
                    projectName: item.name,
                    displayName: item.displayName,
                    hasIcon: !!item.iconDataUrl,
                    rect,
                  })
                }
              />
            ))}
          </div>
        </ScrollArea>

        <div className="mt-2 flex flex-col items-center gap-1 pb-1">
          <Tooltip content="New project" position="right">
            <button
              onClick={onCreateProject}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
              aria-label="New project"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
            </button>
          </Tooltip>
          {archivedCount > 0 && (
            <Tooltip
              content={
                showArchived
                  ? 'Hide archived'
                  : `Show archived (${archivedCount})`
              }
              position="right"
            >
              <button
                onClick={() => setShowArchived((v) => !v)}
                aria-pressed={showArchived}
                className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  showArchived
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
                aria-label={showArchived ? 'Hide archived' : 'Show archived'}
              >
                <Archive className="h-4 w-4" strokeWidth={2} />
                {!showArchived && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-rail bg-muted px-0.5 text-[9px] font-bold leading-none text-muted-foreground">
                    {archivedCount}
                  </span>
                )}
              </button>
            </Tooltip>
          )}
        </div>
      </div>
      {picker && (
        <ProjectColorPicker
          projectName={picker.projectName}
          displayName={picker.displayName}
          currentColorKey={getColor(picker.projectName)}
          isArchived={isProjectArchived(picker.projectName)}
          hasIcon={picker.hasIcon}
          anchorRect={picker.rect}
          onSelect={(key) => setColor(picker.projectName, key)}
          onToggleArchived={() => onToggleArchivedProject(picker.projectName)}
          onIconChanged={onIconChanged}
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );
}
