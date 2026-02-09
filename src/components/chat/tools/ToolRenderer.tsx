import React from 'react';
import { getToolConfig } from './configs/toolConfigs';
import { OneLineDisplay, CollapsibleDisplay, FilePathButton, DiffViewer, MarkdownContent, FileListContent, TodoListContent, TextContent } from './components';
import type { Project } from '../../../types/app';

type DiffLine = {
  type: string;
  content: string;
  lineNum: number;
};

interface ToolRendererProps {
  toolName: string;
  toolInput: any;
  toolResult?: any;
  mode: 'input' | 'result';
  // Callbacks and helpers
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  createDiff?: (oldStr: string, newStr: string) => DiffLine[];
  selectedProject?: Project | null;
  // Display options
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  rawToolInput?: string;
}

/**
 * Main tool renderer router
 * Routes to OneLineDisplay or CollapsibleDisplay based on tool config
 */
export const ToolRenderer: React.FC<ToolRendererProps> = ({
  toolName,
  toolInput,
  toolResult,
  mode,
  onFileOpen,
  createDiff,
  selectedProject,
  autoExpandTools = false,
  showRawParameters = false,
  rawToolInput
}) => {
  const config = getToolConfig(toolName);
  const displayConfig = mode === 'input' ? config.input : config.result;

  if (!displayConfig) return null;

  // Parse tool input/result
  let parsedData: any;
  try {
    const rawData = mode === 'input' ? toolInput : toolResult;
    parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  } catch (e) {
    parsedData = mode === 'input' ? toolInput : toolResult;
  }

  // ============================================================================
  // ONE-LINE DISPLAY
  // ============================================================================
  if (displayConfig.type === 'one-line') {
    const value = displayConfig.getValue?.(parsedData) || '';
    const secondary = displayConfig.getSecondary?.(parsedData);

    const handleAction = () => {
      if (displayConfig.action === 'open-file' && onFileOpen) {
        onFileOpen(value);
      }
    };

    return (
      <OneLineDisplay
        icon={displayConfig.icon}
        label={displayConfig.label}
        value={value}
        secondary={secondary}
        action={displayConfig.action}
        onAction={handleAction}
        colorScheme={displayConfig.colorScheme}
        resultId={mode === 'input' ? `tool-result-${toolName}` : undefined}
      />
    );
  }

  // ============================================================================
  // COLLAPSIBLE DISPLAY
  // ============================================================================
  if (displayConfig.type === 'collapsible') {
    const title = typeof displayConfig.title === 'function'
      ? displayConfig.title(parsedData)
      : displayConfig.title || 'View details';

    const defaultOpen = displayConfig.defaultOpen !== undefined
      ? displayConfig.defaultOpen
      : autoExpandTools;

    // Get content props from config
    const contentProps = displayConfig.getContentProps?.(parsedData, {
      selectedProject,
      createDiff,
      onFileOpen
    }) || {};

    // Render content based on contentType
    let contentComponent = null;

    switch (displayConfig.contentType) {
      case 'diff':
        if (!createDiff) {
          console.error('createDiff function required for diff content type');
          break;
        }
        contentComponent = (
          <DiffViewer
            {...contentProps}
            createDiff={createDiff}
            onFileClick={() => onFileOpen?.(contentProps.filePath)}
          />
        );
        break;

      case 'markdown':
        contentComponent = <MarkdownContent content={contentProps.content || ''} />;
        break;

      case 'file-list':
        contentComponent = (
          <FileListContent
            files={contentProps.files || []}
            onFileClick={onFileOpen}
            title={contentProps.title}
          />
        );
        break;

      case 'todo-list':
        if (!contentProps.todos || contentProps.todos.length === 0) {
          contentComponent = null;
          break;
        }
        contentComponent = (
          <TodoListContent
            todos={contentProps.todos}
            isResult={contentProps.isResult}
          />
        );
        break;

      case 'text':
        contentComponent = (
          <TextContent
            content={contentProps.content || ''}
            format={contentProps.format || 'plain'}
          />
        );
        break;

      case 'success-message':
        const message = displayConfig.getMessage?.(parsedData) || 'Success';
        contentComponent = (
          <div className="flex items-center gap-2 mb-2">
            <span className="font-medium">{message}</span>
          </div>
        );
        break;

      default:
        contentComponent = (
          <div className="text-gray-500">Unknown content type: {displayConfig.contentType}</div>
        );
    }

    // Action button for file operations
    let actionButton = null;
    if (displayConfig.actionButton === 'file-button' && contentProps.filePath) {
      const handleFileClick = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!onFileOpen) return;

        // For Edit/ApplyPatch tools, fetch current file and reverse-apply the edit
        if (toolName === 'Edit' || toolName === 'ApplyPatch') {
          try {
            const { api } = await import('../../../utils/api');
            const response = await api.readFile(selectedProject?.name, contentProps.filePath);
            const data = await response.json();

            if (!response.ok || data.error) {
              console.error('Failed to fetch file:', data.error);
              onFileOpen(contentProps.filePath);
              return;
            }

            const currentContent = data.content || '';
            const oldContent = currentContent.replace(contentProps.newContent, contentProps.oldContent);

            onFileOpen(contentProps.filePath, {
              old_string: oldContent,
              new_string: currentContent
            });
          } catch (error) {
            console.error('Error preparing diff:', error);
            onFileOpen(contentProps.filePath);
          }
        }
        // For Write tool, fetch written file
        else if (toolName === 'Write') {
          try {
            const { api } = await import('../../../utils/api');
            const response = await api.readFile(selectedProject?.name, contentProps.filePath);
            const data = await response.json();

            const newContent = (response.ok && !data.error) ? data.content || '' : contentProps.newContent || '';

            onFileOpen(contentProps.filePath, {
              old_string: '',
              new_string: newContent
            });
          } catch (error) {
            console.error('Error preparing diff:', error);
            onFileOpen(contentProps.filePath, {
              old_string: '',
              new_string: contentProps.newContent || ''
            });
          }
        }
      };

      actionButton = (
        <FilePathButton
          filePath={contentProps.filePath}
          onClick={handleFileClick}
        />
      );
    }

    return (
      <CollapsibleDisplay
        title={title}
        defaultOpen={defaultOpen}
        action={actionButton}
        contentType={displayConfig.contentType || 'text'}
        contentProps={{
          DiffViewer: contentComponent,
          MarkdownComponent: contentComponent,
          FileListComponent: contentComponent,
          TodoListComponent: contentComponent,
          TextComponent: contentComponent
        }}
        showRawParameters={mode === 'input' && showRawParameters}
        rawContent={rawToolInput}
      />
    );
  }

  // ============================================================================
  // SPECIAL / HIDDEN
  // ============================================================================
  return null;
};
