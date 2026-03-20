import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import type { ChatMessage, ClaudePermissionSuggestion, PermissionGrantResult } from '../../types/types';
import type { Project } from '../../../../types/app';
import { summarizeToolGroup } from '../../utils/cleanViewGrouping';
import MessageComponent from './MessageComponent';

interface CollapsedToolGroupProps {
  tools: ChatMessage[];
  createDiff: (oldStr: string, newStr: string) => any;
  onFileOpen?: (filePath: string, diffInfo?: unknown) => void;
  onShowSettings?: () => void;
  onGrantToolPermission?: (suggestion: ClaudePermissionSuggestion) => PermissionGrantResult | null | undefined;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  selectedProject?: Project | null;
  provider: string;
}

export default function CollapsedToolGroup({
  tools,
  createDiff,
  onFileOpen,
  onShowSettings,
  onGrantToolPermission,
  autoExpandTools,
  showRawParameters,
  showThinking,
  selectedProject,
  provider,
}: CollapsedToolGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const summary = useMemo(() => summarizeToolGroup(tools), [tools]);

  return (
    <div className="px-3 sm:px-0">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-left text-xs text-gray-500 transition-colors hover:border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:bg-gray-800"
      >
        <ChevronRight
          className={`h-3 w-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
        />
        <Search className="h-3 w-3 flex-shrink-0 text-gray-400 dark:text-gray-500" />
        <span>
          Research: {summary}
        </span>
        <span className="ml-auto text-gray-400 dark:text-gray-500">
          {tools.length} {tools.length === 1 ? 'call' : 'calls'}
        </span>
      </button>

      {isExpanded && (
        <div className="mt-1 space-y-1 border-l-2 border-gray-200 pl-3 dark:border-gray-700">
          {tools.map((tool, index) => (
            <MessageComponent
              key={tool.toolId || `group-tool-${index}`}
              message={tool}
              prevMessage={index > 0 ? tools[index - 1] : null}
              createDiff={createDiff}
              onFileOpen={onFileOpen}
              onShowSettings={onShowSettings}
              onGrantToolPermission={onGrantToolPermission}
              autoExpandTools={autoExpandTools}
              showRawParameters={showRawParameters}
              showThinking={showThinking}
              selectedProject={selectedProject}
              provider={provider}
            />
          ))}
        </div>
      )}
    </div>
  );
}
