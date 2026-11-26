import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { api } from '@/shared/api';
import type { Plugin, Project } from '@/shared/types';
import { useTheme } from '@/shared/context/ThemeContext';
import { usePluginProjectActions, usePluginSessionActions } from '@/modules/plugins/usePluginProjectActions';
import {
  loadToolRendererModule,
  type PluginToolContext,
  type PluginToolHandle,
} from '@/modules/plugins/tool-renderers/loadToolRendererModule';

type PluginToolRendererProps = {
  plugin: Plugin;
  toolName: string;
  toolId?: string;
  toolInput: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  status: PluginToolContext['status'];
  selectedProject?: Project | null;
  /** The host's own rendering, shown until the plugin draws and whenever it cannot. */
  fallback: ReactNode;
};

/**
 * Renders one chat tool row with a plugin's `renderTool`. Rendered by chat's ToolRenderer for tools a plugin
 * claims through `toolRenderers` in its manifest. Any failure keeps the host's own rendering.
 */
export default function PluginToolRenderer({
  plugin, toolName, toolId, toolInput, toolResult, status, selectedProject, fallback,
}: PluginToolRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<PluginToolHandle | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const { isDarkMode } = useTheme();
  const navigate = useNavigate();
  const { sessionId = null } = useParams();

  const context: PluginToolContext = {
    toolName,
    toolId: toolId ?? null,
    toolInput,
    toolResult: toolResult ? { content: toolResult.content ?? null, isError: Boolean(toolResult.isError) } : null,
    status,
    theme: isDarkMode ? 'dark' : 'light',
    project: selectedProject
      ? { name: selectedProject.projectId, path: selectedProject.fullPath || selectedProject.path || '' }
      : null,
    sessionId,
  };
  const contextRef = useRef(context);
  contextRef.current = context;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const projectActions = usePluginProjectActions();
  const projectActionsRef = useRef(projectActions);
  projectActionsRef.current = projectActions;
  const runProjectAction = async (projectPath: string, action: 'archive' | 'delete') => {
    const run = projectActionsRef.current;
    return run ? run(projectPath, action) : { ok: false as const, error: 'Project actions are not available here' };
  };
  const runProjectActionRef = useRef(runProjectAction);
  const sessionActions = usePluginSessionActions();
  const sessionActionsRef = useRef(sessionActions);
  sessionActionsRef.current = sessionActions;
  const runSessionActionRef = useRef(async (sessionId: string, action: 'archive' | 'delete') => {
    const run = sessionActionsRef.current;
    return run ? run(sessionId, action) : { ok: false as const, error: 'Session actions are not available here' };
  });

  const releaseHandle = () => {
    const handle = handleRef.current;
    handleRef.current = null;
    try { handle?.destroy?.(); } catch { /* plugin error — ignore */ }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let active = true;
    // Show the host rendering until this renderer is ready, and give it a node of its own so a renderer that
    // finishes late can never write into, or clear, the output of the one that replaced it.
    setState('loading');
    const mountNode = document.createElement('div');
    container.appendChild(mountNode);
    (async () => {
      try {
        const mod = await loadToolRendererModule(plugin.name, plugin.entry);
        if (!active) return;
        if (typeof mod.renderTool !== 'function') throw new Error('plugin module has no renderTool export');
        const handle = await mod.renderTool(mountNode, contextRef.current, {
          async rpc(method, path, body) {
            const res = await api.plugins.rpc(plugin.name, method, path, body);
            if (!res.ok) throw new Error(`RPC error ${res.status}`);
            return res.json();
          },
          openSession: (id) => navigateRef.current(`/session/${encodeURIComponent(id)}`),
          archiveProject: (projectPath) => runProjectActionRef.current(projectPath, 'archive'),
          deleteProject: (projectPath) => runProjectActionRef.current(projectPath, 'delete'),
          archiveSession: (sessionId) => runSessionActionRef.current(sessionId, 'archive'),
          deleteSession: (sessionId) => runSessionActionRef.current(sessionId, 'delete'),
        });
        if (!active) {
          handle?.destroy?.();
          return;
        }
        handleRef.current = handle ?? null;
        setState('ready');
      } catch (error) {
        console.error(`[Plugin:${plugin.name}] renderTool failed for ${toolName}:`, error);
        if (active) setState('failed');
      }
    })();
    return () => {
      active = false;
      releaseHandle();
      mountNode.remove();
    };
  }, [plugin.name, plugin.entry, plugin.version, toolName]);

  // Push every prop change (streamed input, the result arriving, theme, project) to the mounted renderer. A renderer
  // whose update throws is released and the host rendering comes back.
  // Keyed on the exact values handed to the plugin (context.project included), so nothing it sees can change silently.
  const contextKey = JSON.stringify([
    toolInput, toolResult?.content, toolResult?.isError, status, isDarkMode, sessionId, context.project,
  ]);
  useEffect(() => {
    if (state !== 'ready') return;
    try {
      handleRef.current?.update?.(contextRef.current);
    } catch (error) {
      console.error(`[Plugin:${plugin.name}] renderTool update failed for ${toolName}:`, error);
      releaseHandle();
      setState('failed');
    }
  }, [contextKey, state, plugin.name, toolName]);

  return (
    <>
      {state !== 'ready' && fallback}
      <div ref={containerRef} hidden={state !== 'ready'} data-plugin-tool={plugin.name} />
    </>
  );
}
