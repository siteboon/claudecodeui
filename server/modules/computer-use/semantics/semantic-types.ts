import type { DisplaySize, Point } from '@/modules/computer-use/computer-executor.js';

export type SemanticBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SemanticApp = {
  id?: string;
  name: string;
  bundleIdentifier?: string;
  processName?: string;
  pid?: number;
  running: boolean;
  windowTitle?: string;
};

export type SemanticElement = {
  index: string;
  role: string;
  title?: string;
  value?: string;
  description?: string;
  enabled?: boolean;
  focused?: boolean;
  selected?: boolean;
  bounds?: SemanticBounds;
  actions?: string[];
  settableValue?: boolean;
};

export type SemanticAppState = {
  stateId: string;
  app: string;
  platform: NodeJS.Platform;
  screenshotDataUrl: string | null;
  displaySize: DisplaySize | null;
  elements: SemanticElement[];
  accessibilityTree: SemanticElement[];
  treeText?: string;
  message?: string;
};

export type SemanticToolInput = Record<string, unknown> & {
  sessionId?: string;
  app?: string;
  stateId?: string;
  element_index?: string;
};

export type SemanticToolResult = SemanticAppState | {
  apps: SemanticApp[];
  platform: NodeJS.Platform;
};

export type SemanticActionPoint = Point;
