import type {
  ClickButton,
  DisplaySize,
  Point,
  ScrollDirection,
} from '@/modules/computer-use/computer-executor.js';

export type RawComputerAction =
  | { type: 'screenshot' }
  | { type: 'cursor_position' }
  | { type: 'mouse_move'; point: Point }
  | { type: 'click'; button: ClickButton; point?: Point; double?: boolean }
  | { type: 'drag'; from: Point; to: Point; button?: ClickButton }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; direction: ScrollDirection; amount?: number; point?: Point }
  | { type: 'wait'; ms?: number };

export type RawActionTarget = {
  displaySize: DisplaySize | null;
};

export type RawActionResult = {
  screenshotDataUrl?: string | null;
  displaySize?: DisplaySize | null;
  cursor?: Point | null;
  position?: Point | null;
};
