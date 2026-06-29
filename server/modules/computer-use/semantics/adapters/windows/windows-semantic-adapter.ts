import { HelperSemanticAdapter } from '@/modules/computer-use/semantics/adapters/helper-semantic-adapter.js';

export function createWindowsSemanticAdapter(): HelperSemanticAdapter {
  return new HelperSemanticAdapter('win32');
}
