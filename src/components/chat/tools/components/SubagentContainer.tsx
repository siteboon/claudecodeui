import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';
import type { SubagentChildTool } from '../../types/types';

interface SubagentContainerProps {
  toolInput: unknown;
  toolResult?: { content?: unknown; isError?: boolean } | null;
  subagentState: {
    childTools: SubagentChildTool[];
    currentToolIndex: number;
    isComplete: boolean;
  };
}

const getCompactToolDisplay = (toolName: string, toolInput: unknown): string => {
  const input = typeof toolInput === 'string' ? (() => {
    try { return JSON.parse(toolInput); } catch { return {}; }
  })() : (toolInput || {});

  switch (toolName) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'ApplyPatch':
      return input.file_path?.split('/').pop() || input.file_path || '';
    case 'Grep':
    case 'Glob':
      return input.pattern || '';
    case 'Bash':
      const cmd = input.command || '';
      return cmd.length > 40 ? `${cmd.slice(0, 40)}...` : cmd;
    case 'Task':
      return input.description || input.subagent_type || '';
    case 'WebFetch':
    case 'WebSearch':
      return input.url || input.query || '';
    default:
      return '';
  }
};

export const SubagentContainer: React.FC<SubagentContainerProps> = ({
  toolInput,
  toolResult,
  subagentState,
}) => {
  const parsedInput = typeof toolInput === 'string' ? (() => {
    try { return JSON.parse(toolInput); } catch { return {}; }
  })() : (toolInput || {});

  const subagentType = parsedInput?.subagent_type || 'Agent';
  const description = parsedInput?.description || 'Running task';
  const prompt = parsedInput?.prompt || '';
  const { childTools, currentToolIndex, isComplete } = subagentState;
  const currentTool = currentToolIndex >= 0 ? childTools[currentToolIndex] : null;

  const title = `${subagentType}: ${description}`;

  return (
    <div className="border-l-2 border-l-purple-500 dark:border-l-purple-400 pl-3 py-0.5 my-1">
      <CollapsibleSection
        title={title}
        toolName="Task"
        open={false}
      >
        {/* Prompt/request to the subagent */}
        {prompt && (
          <div className="text-xs text-gray-600 dark:text-gray-400 mb-2 whitespace-pre-wrap break-words line-clamp-4">
            {prompt}
          </div>
        )}

        {/* Current tool indicator (while running) */}
        {currentTool && !isComplete && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span className="animate-pulse w-1.5 h-1.5 rounded-full bg-purple-500 dark:bg-purple-400 flex-shrink-0" />
            <span className="text-gray-400 dark:text-gray-500">Currently:</span>
            <span className="font-medium text-gray-600 dark:text-gray-300">{currentTool.toolName}</span>
            {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput) && (
              <>
                <span className="text-gray-300 dark:text-gray-600">/</span>
                <span className="font-mono truncate text-gray-500 dark:text-gray-400">
                  {getCompactToolDisplay(currentTool.toolName, currentTool.toolInput)}
                </span>
              </>
            )}
          </div>
        )}

        {/* Completion status */}
        {isComplete && (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mt-1">
            <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Completed ({childTools.length} {childTools.length === 1 ? 'tool' : 'tools'})</span>
          </div>
        )}

        {/* Tool history (collapsed) */}
        {childTools.length > 0 && (
          <details className="mt-2 group/history">
            <summary className="cursor-pointer text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1">
              <svg
                className="w-2.5 h-2.5 transition-transform duration-150 group-open/history:rotate-90 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span>View tool history ({childTools.length})</span>
            </summary>
            <div className="mt-1 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-0.5">
              {childTools.map((child, index) => (
                <div key={child.toolId} className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  <span className="text-gray-400 dark:text-gray-500 w-4 text-right flex-shrink-0">{index + 1}.</span>
                  <span className="font-medium">{child.toolName}</span>
                  {getCompactToolDisplay(child.toolName, child.toolInput) && (
                    <span className="font-mono truncate text-gray-400 dark:text-gray-500">
                      {getCompactToolDisplay(child.toolName, child.toolInput)}
                    </span>
                  )}
                  {child.toolResult?.isError && (
                    <span className="text-red-500 flex-shrink-0">(error)</span>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {/* Final result */}
        {isComplete && toolResult && (
          <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
            {(() => {
              let content = toolResult.content;

              // Handle JSON string that needs parsing
              if (typeof content === 'string') {
                try {
                  const parsed = JSON.parse(content);
                  if (Array.isArray(parsed)) {
                    // Extract text from array format like [{"type":"text","text":"..."}]
                    const textParts = parsed
                      .filter((p: any) => p.type === 'text' && p.text)
                      .map((p: any) => p.text);
                    if (textParts.length > 0) {
                      content = textParts.join('\n');
                    }
                  }
                } catch {
                  // Not JSON, use as-is
                }
              } else if (Array.isArray(content)) {
                // Direct array format
                const textParts = content
                  .filter((p: any) => p.type === 'text' && p.text)
                  .map((p: any) => p.text);
                if (textParts.length > 0) {
                  content = textParts.join('\n');
                }
              }

              return typeof content === 'string' ? (
                <div className="whitespace-pre-wrap break-words line-clamp-6">
                  {content}
                </div>
              ) : content ? (
                <pre className="whitespace-pre-wrap break-words line-clamp-6 font-mono text-[11px]">
                  {JSON.stringify(content, null, 2)}
                </pre>
              ) : null;
            })()}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
};
