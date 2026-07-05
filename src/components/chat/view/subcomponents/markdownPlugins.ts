import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';

export function createChatMarkdownRemarkPlugins(): PluggableList {
  return [remarkGfm, [remarkMath, { singleDollarTextMath: false }]];
}
