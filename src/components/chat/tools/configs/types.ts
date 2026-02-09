import type { ToolResult } from '../../types';

export type ToolCategory = 'command' | 'file-operation' | 'search' | 'todo' | 'plan' | 'default';

export interface ToolConfig {
  /** Tool display name */
  displayName: string;

  /** Tool category for grouping and styling */
  category: ToolCategory;

  /** Icon identifier (can be emoji or icon name) */
  icon?: string;

  /** Whether to show minimized display by default */
  minimized?: boolean;

  /** Name of the renderer component to use */
  renderer: string;

  /** Whether to hide successful results (show only errors) */
  hideSuccessfulResult?: boolean;

  /** Whether this tool requires file system access */
  requiresFileAccess?: boolean;

  /** Whether this tool supports copy to clipboard */
  supportsCopy?: boolean;

  /** Custom function to determine if result should be hidden */
  shouldHideResult?: (result: ToolResult | null) => boolean;

  /** Color scheme for the tool display */
  colorScheme?: {
    primary: string;
    secondary: string;
  };
}

export type ToolConfigRegistry = Record<string, ToolConfig>;
