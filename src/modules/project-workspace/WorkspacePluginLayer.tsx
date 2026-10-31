import { useProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
import { PluginHostLayer } from '@/modules/plugins';

/**
 * Rendered by the workspace shell to keep resident plugins mounted across tab,
 * project and session changes.
 *
 * It reads the workspace state itself instead of receiving it as props, so a
 * project or session switch re-renders this one node rather than the whole
 * memoized shell. The layer inside only re-mounts when the resident plugin set
 * changes, so switching projects only pushes a new context to the plugins.
 */
export default function WorkspacePluginLayer() {
  const { selectedProject, selectedSession } = useProjectMainState();

  return (
    <PluginHostLayer
      selectedProject={selectedProject}
      selectedSession={selectedSession}
    />
  );
}
