import { useTranslation } from 'react-i18next';
import type { AgentCategory } from '../../../../types/types';
import type { AgentCategoryTabsSectionProps } from '../types';

const AGENT_CATEGORIES: AgentCategory[] = ['account', 'permissions', 'mcp'];

export default function AgentCategoryTabsSection({
  selectedCategory,
  onSelectCategory,
}: AgentCategoryTabsSectionProps) {
  const { t } = useTranslation('settings');

  return (
    <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700">
      <div role="tablist" className="flex overflow-x-auto px-2 md:px-4">
        {AGENT_CATEGORIES.map((category) => (
          <button
            key={category}
            role="tab"
            aria-selected={selectedCategory === category}
            onClick={() => onSelectCategory(category)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors md:px-4 md:py-3 md:text-sm ${
              selectedCategory === category
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {category === 'account' && t('tabs.account')}
            {category === 'permissions' && t('tabs.permissions')}
            {category === 'mcp' && t('tabs.mcpServers')}
          </button>
        ))}
      </div>
    </div>
  );
}
