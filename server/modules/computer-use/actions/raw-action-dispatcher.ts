import {
  captureScreenshot,
  executor,
  type ExecutorTarget,
} from '@/modules/computer-use/computer-executor.js';
import type { RawActionResult, RawComputerAction, RawActionTarget } from '@/modules/computer-use/actions/raw-action-types.js';

const DEFAULT_WAIT_MS = 1000;
const MAX_WAIT_MS = 10_000;

function normalizeWaitMs(ms: number | undefined): number {
  if (ms === undefined) {
    return DEFAULT_WAIT_MS;
  }
  if (!Number.isFinite(ms)) {
    throw new Error('Computer Use wait duration must be a finite number.');
  }
  return Math.trunc(Math.max(0, Math.min(ms, MAX_WAIT_MS)));
}

async function snapshot(target: RawActionTarget): Promise<RawActionResult> {
  const { dataUrl, size } = await captureScreenshot();
  return { screenshotDataUrl: dataUrl, displaySize: size || target.displaySize };
}

export async function runRawComputerAction(
  action: RawComputerAction,
  target: RawActionTarget,
): Promise<RawActionResult> {
  const executorTarget: ExecutorTarget = {
    displaySize: target.displaySize,
  };

  switch (action.type) {
    case 'screenshot':
      return snapshot(target);
    case 'cursor_position': {
      const position = await executor.cursorPosition(executorTarget);
      return { ...(await snapshot(target)), position, cursor: position };
    }
    case 'mouse_move':
      await executor.moveTo(executorTarget, action.point);
      return { ...(await snapshot(target)), cursor: action.point };
    case 'click':
      await executor.click(executorTarget, action.button, action.point, action.double === true);
      return { ...(await snapshot(target)), cursor: action.point ?? null };
    case 'drag':
      await executor.drag(executorTarget, action.from, action.to, action.button ?? 'left');
      return { ...(await snapshot(target)), cursor: action.to };
    case 'type':
      await executor.type(action.text);
      return snapshot(target);
    case 'key':
      await executor.pressChord(action.key);
      return snapshot(target);
    case 'scroll':
      await executor.scroll(executorTarget, action.direction, action.amount ?? 3, action.point);
      return { ...(await snapshot(target)), cursor: action.point ?? null };
    case 'wait':
      await new Promise((resolve) => setTimeout(resolve, normalizeWaitMs(action.ms)));
      return snapshot(target);
    default: {
      const exhaustive: never = action;
      throw new Error(`Unsupported computer action: ${(exhaustive as { type?: string }).type || 'unknown'}`);
    }
  }
}
