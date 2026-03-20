import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';

interface SkillLoadChipProps {
  skillName: string;
  timestamp: string | number | Date;
}

export default function SkillLoadChip({ skillName, timestamp }: SkillLoadChipProps) {
  const { t } = useTranslation('chat');

  const formattedTime = useMemo(() => {
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString();
  }, [timestamp]);

  return (
    <div className="flex items-center gap-2 px-3 py-1 sm:px-0">
      <div className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
        <Zap className="h-3 w-3" />
        <span>{t('cleanView.loadedSkill', { defaultValue: 'Loaded skill:' })} <span className="font-medium">{skillName}</span></span>
        {formattedTime && <span className="text-gray-400 dark:text-gray-500">{formattedTime}</span>}
      </div>
    </div>
  );
}
