import { useState, useRef, useEffect, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
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
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);

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

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    onClose?.();
  }, [onClose]);

  const updateDropdownPosition = useCallback(() => {
    const trigger = triggerRef.current;
    const dropdown = dropdownRef.current;
    if (!trigger || !dropdown || typeof window === 'undefined') {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const viewportPadding = window.innerWidth < 640 ? 12 : 16;
    const spacing = 8;
    const width = Math.min(window.innerWidth - viewportPadding * 2, window.innerWidth < 640 ? 320 : 256);
    let left = triggerRect.left + triggerRect.width / 2 - width / 2;
    left = Math.max(viewportPadding, Math.min(left, window.innerWidth - width - viewportPadding));

    const measuredHeight = dropdown.offsetHeight || 0;
    const spaceBelow = window.innerHeight - triggerRect.bottom - spacing - viewportPadding;
    const spaceAbove = triggerRect.top - spacing - viewportPadding;
    const openBelow = spaceBelow >= Math.min(measuredHeight || 320, 320) || spaceBelow >= spaceAbove;
    const availableHeight = Math.min(
      window.innerHeight - viewportPadding * 2,
      Math.max(180, openBelow ? spaceBelow : spaceAbove),
    );
    const panelHeight = Math.min(measuredHeight || availableHeight, availableHeight);
    const top = openBelow
      ? Math.min(triggerRect.bottom + spacing, window.innerHeight - viewportPadding - panelHeight)
      : Math.max(viewportPadding, triggerRect.top - spacing - panelHeight);

    setDropdownStyle({
      position: 'fixed',
      top,
      left,
      width,
      maxHeight: availableHeight,
      zIndex: 80,
    });
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setDropdownStyle(null);
      return;
    }

    const rafId = window.requestAnimationFrame(updateDropdownPosition);
    const handleViewportChange = () => updateDropdownPosition();

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [isOpen, updateDropdownPosition]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (containerRef.current?.contains(target) || dropdownRef.current?.contains(target)) {
        return;
      }

      closeDropdown();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDropdown();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeDropdown]);

  const currentMode = translatedModes.find(mode => mode.id === selectedMode) || translatedModes[0];
  const IconComponent = currentMode.icon || Brain;
  const isActive = selectedMode !== 'none';

  const activeBgMap: Record<string, string> = {
    'text-blue-600':   'bg-blue-50   hover:bg-blue-100   dark:bg-blue-950/40  dark:hover:bg-blue-950/60',
    'text-purple-600': 'bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-950/60',
    'text-indigo-600': 'bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/60',
    'text-red-600':    'bg-red-50    hover:bg-red-100    dark:bg-red-950/40   dark:hover:bg-red-950/60',
  };
  const activeBg = activeBgMap[currentMode.color] ?? 'bg-muted hover:bg-muted/80';

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            closeDropdown();
            return;
          }

          setIsOpen(true);
        }}
        className={`flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-all duration-150 ${
          isActive
            ? `border-transparent ${currentMode.color} ${activeBg}`
            : 'border-border/60 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
        title={t('thinkingMode.buttonTitle', { mode: currentMode.name })}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <IconComponent className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden whitespace-nowrap sm:inline">
          {isActive ? currentMode.name : 'Think'}
        </span>
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={dropdownStyle || { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
          className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
          role="dialog"
          aria-modal="false"
        >
          <div className="border-b border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t('thinkingMode.selector.title')}
              </h3>
              <button
                type="button"
                onClick={closeDropdown}
                className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {t('thinkingMode.selector.description')}
            </p>
          </div>

          <div className="min-h-0 overflow-y-auto py-1">
            {translatedModes.map((mode) => {
              const ModeIcon = mode.icon;
              const isSelected = mode.id === selectedMode;

              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    onModeChange(mode.id);
                    closeDropdown();
                  }}
                  className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700 ${isSelected ? 'bg-gray-50 dark:bg-gray-700' : ''
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 ${mode.icon ? mode.color : 'text-gray-400'}`}>
                      {ModeIcon ? <ModeIcon className="h-5 w-5" /> : <div className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
                          }`}>
                          {mode.name}
                        </span>
                        {isSelected && (
                          <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                            {t('thinkingMode.selector.active')}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        {mode.description}
                      </p>
                      {mode.prefix && (
                        <code className="mt-1 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs dark:bg-gray-700">
                          {mode.prefix}
                        </code>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="border-t border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              <strong>Tip:</strong> {t('thinkingMode.selector.tip')}
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default ThinkingModeSelector;
