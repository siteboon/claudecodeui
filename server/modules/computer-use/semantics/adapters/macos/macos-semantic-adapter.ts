import { HelperSemanticAdapter } from '@/modules/computer-use/semantics/adapters/helper-semantic-adapter.js';

export function createMacOsSemanticAdapter(): HelperSemanticAdapter {
  return new HelperSemanticAdapter('darwin');
}
