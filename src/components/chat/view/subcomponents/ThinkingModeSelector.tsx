import { useState, useRef, useEffect } from 'react';
import { Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { thinkingModes } from '../../constants/thinkingModes';

type ThinkingModeSelectorProps = {
  selectedMode: string;
  onModeChange: (modeId: string) => void;
  onClose?: () => void;
  className?: string;
};

function ThinkingModeSelector({ selectedMode, onModeChange, onClose, className = '' }: ThinkingModeSelectorProps) {
  const { t } = useTranslation('chat');

  // Mapping from mode ID to translation key
  const modeKeyMap: Record<string, string> = {
    'think-hard': 'thinkHard',
    'think-harder': 'thinkHarder'
  };
  // Create translated modes for display
  const translatedModes = thinkingModes.map(mode => {
    const modeKey = modeKeyMap[mode.id] || mode.id;
    return {
      ...mode,
      name: t(`thinkingMode.modes.${modeKey}.name`),
      description: t(`thinkingMode.modes.${modeKey}.description`),
      prefix: t(`thinkingMode.modes.${modeKey}.prefix`)
    };
  });

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        if (onClose) onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const currentMode = translatedModes.find(mode => mode.id === selectedMode) || translatedModes[0];
  const IconComponent = currentMode.icon || Brain;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-10 h-10 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all duration-200 ${selectedMode === 'none'
            ? 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600'
            : 'bg-blue-100 hover:bg-blue-200 dark:bg-blue-900 dark:hover:bg-blue-800'
          }`}
        title={t('thinkingMode.buttonTitle', { mode: currentMode.name })}
      >
        <IconComponent className={`w-5 h-5 ${currentMode.color}`} />
      </button>

      {isOpen && (
        <div className="absolute bottom-full right-0 mb-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="p-3 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('thinkingMode.selector.title')}
              </h3>
              <button
                onClick={() => {
                  setIsOpen(false);
                  if (onClose) onClose();
                }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('thinkingMode.selector.description')}
            </p>
          </div>

          <div className="py-1">
            {translatedModes.map((mode) => {
              const ModeIcon = mode.icon;
              const isSelected = mode.id === selectedMode;

              return (
                <button
                  key={mode.id}
                  onClick={() => {
                    onModeChange(mode.id);
                    setIsOpen(false);
                    if (onClose) onClose();
                  }}
                  className={`w-full px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${isSelected ? 'bg-gray-50 dark:bg-gray-700' : ''
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${mode.icon ? mode.color : 'text-gray-400'}`}>
                      {ModeIcon ? <ModeIcon className="w-5 h-5" /> : <div className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium text-sm ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
                          }`}>
                          {mode.name}
                        </span>
                        {isSelected && (
                          <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                            {t('thinkingMode.selector.active')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {mode.description}
                      </p>
                      {mode.prefix && (
                        <code className="text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded mt-1 inline-block">
                          {mode.prefix}
                        </code>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              <strong>Tip:</strong> {t('thinkingMode.selector.tip')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default ThinkingModeSelector;