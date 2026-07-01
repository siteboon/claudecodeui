import { useTranslation } from 'react-i18next';

import { cn } from '../../../../../../lib/utils';
import type { AgentCategoryTabsSectionProps } from '../types';

export default function AgentCategoryTabsSection({
  categories,
  selectedAgent,
  selectedCategory,
  onSelectCategory,
}: AgentCategoryTabsSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="flex-shrink-0 border-b border-border">
      <div role="tablist" className="flex overflow-x-auto px-2 md:px-4">
        {categories.map((category) => (
          <button
            key={category}
            role="tab"
            aria-selected={selectedCategory === category}
            onClick={() => onSelectCategory(category)}
            className={cn(
              'whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium touch-manipulation transition-colors duration-150',
              selectedCategory === category
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {category === 'account' && t('tabs.account')}
            {category === 'permissions' && t('tabs.permissions')}
            {category === 'gateway' && t('tabs.gateway', { defaultValue: 'Gateway' })}
            {category === 'mcp' && t('tabs.mcpServers')}
            {category === 'skills' && t('tabs.skills', {
              defaultValue: selectedAgent === 'opencode' ? 'Shared Skills' : 'Skills',
            })}
          </button>
        ))}
      </div>
    </div>
  );
}
