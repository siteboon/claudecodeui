import { useEffect, useRef } from 'react';

import { useTheme } from '@/shared/context/ThemeContext';
import type { Project, ProjectSession } from '@/shared/types';
import { usePlugins } from '@/modules/plugins/context/PluginsContext';
import {
  createPluginHostApi,
  loadPluginModule,
  type PluginHostApi,
  type PluginSurface,
} from '@/modules/plugins/pluginModuleLoader';

/** What the resident layer publishes: the tab context plus the surface that mounted it. */
export type ResidentPluginContext = {
  theme: 'dark' | 'light';
  // Same project/session shape the tab surface uses, so one plugin bundle can
  // serve both surfaces without branching on which one mounted it.
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
  /** A resident plugin is mounted once for the whole app session, whatever tab is open. */
  surface: PluginSurface;
};

type ResidentPluginModule = {
  mount?: (container: HTMLElement, host: PluginHostApi<ResidentPluginContext>) => void | Promise<void>;
  unmount?: (container: HTMLElement) => void;
};

type PluginHostLayerProps = {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
};

function buildResidentContext(
  isDarkMode: boolean,
  selectedProject: Project | null,
  selectedSession: ProjectSession | null,
): ResidentPluginContext {
  return {
    theme: isDarkMode ? 'dark' : 'light',
    project: selectedProject
      ? {
        name: selectedProject.projectId,
        path: selectedProject.fullPath || selectedProject.path || '',
      }
      : null,
    session: selectedSession
      ? {
        id: selectedSession.id,
        title: selectedSession.title || selectedSession.name || selectedSession.id,
      }
      : null,
    surface: 'resident',
  };
}

/**
 * Rendered by the project-workspace module beside the workspace itself: mounts
 * every enabled plugin whose manifest sets `alwaysMount` for the whole app
 * session, so such a plugin no longer has to be opened as a tab before its code
 * exists on the page.
 *
 * The container is deliberately empty and zero-sized. A resident plugin builds
 * its own DOM and appends it to `document.body` (or positions it fixed), which
 * keeps this layer out of the workspace layout; anything rendered inside the
 * container would be invisible by design.
 *
 * A plugin that mounts here gets the same `mount(container, host)` contract as
 * the tab surface, so a bundle can support both and branch on `host.context.surface`.
 */
export default function PluginHostLayer({ selectedProject, selectedSession }: PluginHostLayerProps) {
  const { isDarkMode } = useTheme();
  const { plugins } = usePlugins();
  const hostRef = useRef<HTMLDivElement>(null);

  const contextRef = useRef<ResidentPluginContext>(
    buildResidentContext(isDarkMode, selectedProject, selectedSession),
  );
  const contextCallbacksRef = useRef<Set<(context: ResidentPluginContext) => void>>(new Set());

  // Read inside the mount effect so an unrelated plugin-list change does not
  // remount resident plugins whose entry has not changed. Written in an effect
  // declared above that one, so it is already current when the mount runs.
  const pluginsRef = useRef(plugins);

  // Identity of the resident set: mounting is re-run only when this changes, so
  // context updates travel through the callbacks above instead.
  const residentKey = plugins
    .filter((plugin) => plugin.enabled && plugin.alwaysMount)
    .map((plugin) => `${plugin.name}@${plugin.entry}`)
    .sort()
    .join('|');

  useEffect(() => {
    pluginsRef.current = plugins;
  }, [plugins]);

  useEffect(() => {
    const context = buildResidentContext(isDarkMode, selectedProject, selectedSession);
    contextRef.current = context;

    for (const callback of contextCallbacksRef.current) {
      try { callback(context); } catch { /* plugin error — isolate it */ }
    }
  }, [isDarkMode, selectedProject, selectedSession]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !residentKey) return;

    const contextCallbacks = contextCallbacksRef.current;
    const residentPlugins = pluginsRef.current.filter((plugin) => plugin.enabled && plugin.alwaysMount);
    const mounted: Array<{ container: HTMLElement; module: ResidentPluginModule | null }> = [];
    let active = true;

    for (const plugin of residentPlugins) {
      // One detached container per plugin, so two resident plugins can never
      // fight over the same mount target.
      const container = document.createElement('div');
      container.dataset.cloudcliResidentPlugin = plugin.name;
      host.appendChild(container);

      const record: { container: HTMLElement; module: ResidentPluginModule | null } = {
        container,
        module: null,
      };
      mounted.push(record);

      const hostApi = createPluginHostApi<ResidentPluginContext>(
        plugin.name,
        () => contextRef.current,
        (callback) => {
          contextCallbacks.add(callback);
          return () => { contextCallbacks.delete(callback); };
        },
      );

      void (async () => {
        try {
          const pluginModule = await loadPluginModule(plugin.name, plugin.entry) as ResidentPluginModule;
          if (typeof pluginModule.mount !== 'function') {
            throw new Error('module does not export mount()');
          }

          record.module = pluginModule;
          await pluginModule.mount(container, hostApi);

          // A plugin that finished mounting after the layer was torn down must
          // not leave its listeners behind.
          if (!active) {
            try { record.module?.unmount?.(container); } catch { /* plugin error — isolate it */ }
            record.module = null;
          }
        } catch (error) {
          console.error(`[Plugin:${plugin.name}] Resident mount failed:`, error);
        }
      })();
    }

    return () => {
      active = false;
      for (const record of mounted) {
        try { record.module?.unmount?.(record.container); } catch { /* plugin error — isolate it */ }
        record.container.remove();
      }
    };
  }, [residentKey]);

  // Zero-sized and out of flow, so adding a resident plugin can never shift the
  // workspace beside it — but still rendered, so a plugin that positions
  // content inside its own container is not silently hidden. `pointer-events`
  // is deliberately not disabled here: it would be inherited by that content.
  return (
    <div
      ref={hostRef}
      data-cloudcli-plugin-layer=""
      style={{ position: 'fixed', top: 0, left: 0, width: 0, height: 0, overflow: 'visible' }}
    />
  );
}
