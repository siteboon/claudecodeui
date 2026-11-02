import { memo, useCallback, useEffect, useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { useProjectSlashCommands } from '@/shared/hooks/useProjectSlashCommands';
import { useSelectedProvider } from '@/shared/hooks/useSelectedProvider';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useTheme } from '@/shared/context/ThemeContext';
import { useQuickSettingsDrag } from '@/modules/quick-settings-panel/hooks/useQuickSettingsDrag';
import { useQuickSettingsPanelState } from '@/modules/quick-settings-panel/hooks/useQuickSettingsPanelState';
import type {
  PreferenceToggleKey,
  Project,
  QuickSettingsPreferences,
  SlashCommand,
} from '@/shared/types';
import { getQuickSettingsTabId, getQuickSettingsTabPanelId } from '@/shared/utils';
import QuickSettingsCommandsTab from '@/modules/quick-settings-panel/QuickSettingsCommandsTab';
import QuickSettingsContent from '@/modules/quick-settings-panel/QuickSettingsContent';
import QuickSettingsHandle from '@/modules/quick-settings-panel/QuickSettingsHandle';
import QuickSettingsPanelHeader from '@/modules/quick-settings-panel/QuickSettingsPanelHeader';
import QuickSettingsTabs from '@/modules/quick-settings-panel/QuickSettingsTabs';

type QuickSettingsPanelViewProps = {
  selectedProject: Project | null;
  // Receives a command picked on the Commands tab; the caller decides where
  // it goes (the project workspace hands it to the chat composer).
  onInsertCommand?: (command: SlashCommand) => void;
};

/** Exported as QuickSettingsPanel and rendered by the project-workspace module as its quick settings drawer — an overlay by default, docked into the workspace row when pinned. */
function QuickSettingsPanelView({ selectedProject, onInsertCommand }: QuickSettingsPanelViewProps) {
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const canPin = !isMobile;
  const {
    isOpen,
    isPinned,
    activeTab,
    close,
    toggle,
    selectTab,
    togglePin,
  } = useQuickSettingsPanelState({ canPin });
  const { isDarkMode } = useTheme();
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const provider = useSelectedProvider();
  const {
    commands,
    isLoading: isLoadingCommands,
    error: commandsError,
  } = useProjectSlashCommands(selectedProject, provider, {
    // The composer already loads this list on every project switch; only pay
    // for a second request while the Commands tab is actually showing.
    enabled: isOpen && activeTab === 'commands',
  });
  const {
    isDragging,
    handleStyle,
    startDrag,
    consumeSuppressedClick,
  } = useQuickSettingsDrag({ isMobile });

  const quickSettingsPreferences = useMemo<QuickSettingsPreferences>(() => ({
    showRawParameters: preferences.showRawParameters,
    showThinking: preferences.showThinking,
    sendByCtrlEnter: preferences.sendByCtrlEnter,
    voiceEnabled: preferences.voiceEnabled,
  }), [
    preferences.sendByCtrlEnter,
    preferences.showRawParameters,
    preferences.showThinking,
    preferences.voiceEnabled,
  ]);

  const handlePreferenceChange = useCallback(
    (key: PreferenceToggleKey, value: boolean) => {
      setPreference(key, value);
    },
    [setPreference],
  );

  const handleToggleFromHandle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      // A drag releases a click event as well; this guard prevents accidental toggles.
      if (consumeSuppressedClick()) {
        event.preventDefault();
        return;
      }

      toggle();
    },
    [consumeSuppressedClick, toggle],
  );

  const handleInsertCommand = useCallback(
    (command: SlashCommand) => {
      onInsertCommand?.(command);
      // An overlay is in the way of the composer it just filled; a docked panel
      // is part of the layout and stays.
      if (!isPinned) {
        close();
      }
    },
    [close, isPinned, onInsertCommand],
  );

  // Escape dismisses an open overlay. The overlay is the topmost layer, so it
  // must see the key before the handlers underneath it — the chat's
  // capture-phase abort-on-Escape and the editor's close-on-Escape — and
  // consume it; window capture runs ahead of both. Keys another layer already
  // consumed (e.g. the composer's own `/` menu closing) are left alone.
  useEffect(() => {
    if (!isOpen || isPinned) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [close, isOpen, isPinned]);

  const panelBody = (
    <div className="flex h-full flex-col">
      <QuickSettingsPanelHeader
        isPinned={isPinned}
        canPin={canPin}
        onTogglePin={togglePin}
        onClose={close}
      />
      <QuickSettingsTabs activeTab={activeTab} onSelectTab={selectTab} />
      <div
        role="tabpanel"
        id={getQuickSettingsTabPanelId(activeTab)}
        aria-labelledby={getQuickSettingsTabId(activeTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        {activeTab === 'settings' ? (
          <QuickSettingsContent
            isDarkMode={isDarkMode}
            preferences={quickSettingsPreferences}
            onPreferenceChange={handlePreferenceChange}
          />
        ) : (
          <QuickSettingsCommandsTab
            hasProject={selectedProject !== null}
            commands={commands}
            isLoading={isLoadingCommands}
            hasError={commandsError}
            onInsertCommand={handleInsertCommand}
          />
        )}
      </div>
    </div>
  );

  return (
    <>
      <QuickSettingsHandle
        isOpen={isOpen}
        isDragging={isDragging}
        style={handleStyle}
        onClick={handleToggleFromHandle}
        onMouseDown={startDrag}
        onTouchStart={startDrag}
      />

      {/* Docked: a layout column while open, gone while collapsed via the handle (the pin is kept). */}
      {isPinned ? (
        isOpen && (
          <div className="relative h-full w-64 flex-shrink-0 border-l border-border bg-background">
            {panelBody}
          </div>
        )
      ) : (
        <div
          className={`fixed right-0 top-0 z-[9999] h-full w-64 transform border-l border-border bg-background shadow-xl transition-transform duration-150 ease-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} ${isMobile ? 'h-screen' : ''}`}
        >
          {panelBody}
        </div>
      )}

      {isOpen && !isPinned && (
        <div
          className="fixed inset-0 z-[9998] bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
          onClick={close}
        />
      )}
    </>
  );
}

export default memo(QuickSettingsPanelView);
