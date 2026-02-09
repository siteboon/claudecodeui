/**
 * Centralized tool configuration registry
 * Defines display behavior for all tool types using config-driven architecture
 */

export interface ToolDisplayConfig {
  input: {
    type: 'one-line' | 'collapsible' | 'hidden';
    // One-line config
    icon?: string;
    label?: string;
    getValue?: (input: any) => string;
    getSecondary?: (input: any) => string | undefined;
    action?: 'copy' | 'open-file' | 'jump-to-results' | 'none';
    colorScheme?: {
      primary?: string;
      secondary?: string;
    };
    // Collapsible config
    title?: string | ((input: any) => string);
    defaultOpen?: boolean;
    contentType?: 'diff' | 'markdown' | 'file-list' | 'todo-list' | 'text';
    getContentProps?: (input: any, helpers?: any) => any;
    actionButton?: 'file-button' | 'none';
  };
  result?: {
    hidden?: boolean;
    hideOnSuccess?: boolean;
    type?: 'one-line' | 'collapsible' | 'special';
    // Special result handlers
    contentType?: 'markdown' | 'file-list' | 'todo-list' | 'text' | 'success-message';
    getMessage?: (result: any) => string;
    getContentProps?: (result: any) => any;
  };
}

export const TOOL_CONFIGS: Record<string, ToolDisplayConfig> = {
  // ============================================================================
  // COMMAND TOOLS
  // ============================================================================

  Bash: {
    input: {
      type: 'one-line',
      icon: 'terminal',
      getValue: (input) => input.command,
      getSecondary: (input) => input.description,
      action: 'copy',
      style: 'terminal',
      wrapText: true,
      colorScheme: {
        primary: 'text-green-400 font-mono',
        secondary: 'text-gray-400',
        background: 'bg-gray-900 dark:bg-black',
        border: 'border-green-500 dark:border-green-400',
        icon: 'text-green-500 dark:text-green-400'
      }
    },
    result: {
      hideOnSuccess: true,
      type: 'special' // Interactive prompts, cat -n output, etc.
    }
  },

  // ============================================================================
  // FILE OPERATION TOOLS
  // ============================================================================

  Read: {
    input: {
      type: 'one-line',
      label: 'Read',
      getValue: (input) => input.file_path,
      action: 'open-file',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300'
      }
    },
    result: {
      hidden: true // Read results not displayed
    }
  },

  Edit: {
    input: {
      type: 'collapsible',
      title: 'View edit diff for',
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'file-button',
      getContentProps: (input) => ({
        oldContent: input.old_string,
        newContent: input.new_string,
        filePath: input.file_path,
        badge: 'Diff',
        badgeColor: 'gray'
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  Write: {
    input: {
      type: 'collapsible',
      title: 'Creating new file',
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'file-button',
      getContentProps: (input) => ({
        oldContent: '',
        newContent: input.content,
        filePath: input.file_path,
        badge: 'New File',
        badgeColor: 'green'
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  ApplyPatch: {
    input: {
      type: 'collapsible',
      title: 'View patch diff for',
      defaultOpen: false,
      contentType: 'diff',
      actionButton: 'file-button',
      getContentProps: (input) => ({
        oldContent: input.old_string,
        newContent: input.new_string,
        filePath: input.file_path,
        badge: 'Patch',
        badgeColor: 'gray'
      })
    },
    result: {
      hideOnSuccess: true
    }
  },

  // ============================================================================
  // SEARCH TOOLS
  // ============================================================================

  Grep: {
    input: {
      type: 'one-line',
      label: 'Grep',
      getValue: (input) => input.pattern,
      getSecondary: (input) => input.path ? `in ${input.path}` : undefined,
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      type: 'collapsible',
      contentType: 'file-list',
      getContentProps: (result) => {
        const toolData = result.toolUseResult || {};
        return {
          files: toolData.filenames || [],
          title: toolData.filenames ?
            `Found ${toolData.numFiles || toolData.filenames.length} ${(toolData.numFiles === 1 || toolData.filenames.length === 1) ? 'file' : 'files'}`
            : undefined
        };
      }
    }
  },

  Glob: {
    input: {
      type: 'one-line',
      label: 'Glob',
      getValue: (input) => input.pattern,
      getSecondary: (input) => input.path ? `in ${input.path}` : undefined,
      action: 'jump-to-results',
      colorScheme: {
        primary: 'text-gray-700 dark:text-gray-300',
        secondary: 'text-gray-500 dark:text-gray-400'
      }
    },
    result: {
      type: 'collapsible',
      contentType: 'file-list',
      getContentProps: (result) => {
        const toolData = result.toolUseResult || {};
        return {
          files: toolData.filenames || [],
          title: toolData.filenames ?
            `Found ${toolData.numFiles || toolData.filenames.length} ${(toolData.numFiles === 1 || toolData.filenames.length === 1) ? 'file' : 'files'}`
            : undefined
        };
      }
    }
  },

  // ============================================================================
  // TODO TOOLS
  // ============================================================================

  TodoWrite: {
    input: {
      type: 'collapsible',
      title: 'Updating Todo List',
      defaultOpen: false,
      contentType: 'todo-list',
      getContentProps: (input) => ({
        todos: input.todos
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'success-message',
      getMessage: () => 'Todo list has been updated successfully'
    }
  },

  TodoRead: {
    input: {
      type: 'one-line',
      label: 'Read todo list',
      getValue: () => '',
      action: 'none'
    },
    result: {
      type: 'collapsible',
      contentType: 'todo-list',
      getContentProps: (result) => {
        try {
          const content = String(result.content || '');
          let todos = null;
          if (content.startsWith('[')) {
            todos = JSON.parse(content);
          }
          return { todos, isResult: true };
        } catch (e) {
          return { todos: [], isResult: true };
        }
      }
    }
  },

  // ============================================================================
  // PLAN TOOLS
  // ============================================================================

  exit_plan_mode: {
    input: {
      type: 'collapsible',
      title: 'View implementation plan',
      defaultOpen: true,
      contentType: 'markdown',
      getContentProps: (input) => ({
        content: input.plan?.replace(/\\n/g, '\n') || input.plan
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'markdown',
      getContentProps: (result) => {
        try {
          let parsed = result.content;
          if (typeof parsed === 'string') {
            parsed = JSON.parse(parsed);
          }
          return {
            content: parsed.plan?.replace(/\\n/g, '\n') || parsed.plan
          };
        } catch (e) {
          return { content: '' };
        }
      }
    }
  },

  // ============================================================================
  // DEFAULT FALLBACK
  // ============================================================================

  Default: {
    input: {
      type: 'collapsible',
      title: 'View input parameters',
      defaultOpen: false,
      contentType: 'text',
      getContentProps: (input) => ({
        content: typeof input === 'string' ? input : JSON.stringify(input, null, 2),
        format: 'code'
      })
    },
    result: {
      type: 'collapsible',
      contentType: 'text',
      getContentProps: (result) => ({
        content: String(result.content || ''),
        format: 'plain'
      })
    }
  }
};

/**
 * Get configuration for a tool, with fallback to default
 */
export function getToolConfig(toolName: string): ToolDisplayConfig {
  return TOOL_CONFIGS[toolName] || TOOL_CONFIGS.Default;
}

/**
 * Check if a tool result should be hidden
 */
export function shouldHideToolResult(toolName: string, toolResult: any): boolean {
  const config = getToolConfig(toolName);

  if (!config.result) return false;

  // Always hidden
  if (config.result.hidden) return true;

  // Hide on success only
  if (config.result.hideOnSuccess && toolResult && !toolResult.isError) {
    return true;
  }

  return false;
}
