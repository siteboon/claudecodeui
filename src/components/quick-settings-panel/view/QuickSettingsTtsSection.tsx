import { Volume2, VolumeX, Play } from 'lucide-react';
import type { VoiceInfo } from '../../../hooks/useSpeechOutput';
import { SETTING_ROW_CLASS } from '../constants';
import QuickSettingsSection from './QuickSettingsSection';

type QuickSettingsTtsSectionProps = {
  enabled: boolean;
  onToggle: () => void;
  rate: number;
  onRateChange: (rate: number) => void;
  pitch: number;
  onPitchChange: (pitch: number) => void;
  voiceURI: string;
  onVoiceChange: (voiceURI: string) => void;
  lang: string;
  onLangChange: (lang: string) => void;
  filteredVoices: VoiceInfo[];
  availableLanguages: string[];
  onTestVoice: () => void;
  isSpeaking: boolean;
  onStop: () => void;
};

export default function QuickSettingsTtsSection({
  enabled,
  onToggle,
  rate,
  onRateChange,
  pitch,
  onPitchChange,
  voiceURI,
  onVoiceChange,
  lang,
  onLangChange,
  filteredVoices,
  availableLanguages,
  onTestVoice,
  isSpeaking,
  onStop,
}: QuickSettingsTtsSectionProps) {
  return (
    <QuickSettingsSection title="Text-to-Speech">
      {/* Enable/Disable toggle */}
      <div className={SETTING_ROW_CLASS}>
        <span className="flex items-center gap-2 text-sm text-gray-900 dark:text-white">
          {enabled ? (
            <Volume2 className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          ) : (
            <VolumeX className="h-4 w-4 text-gray-600 dark:text-gray-400" />
          )}
          TTS Enabled
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={onToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
            enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
              enabled ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <>
          {/* Language filter */}
          <div className="space-y-1 px-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">Language</label>
            <select
              value={lang}
              onChange={(e) => {
                onLangChange(e.target.value);
                onVoiceChange('');
              }}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              <option value="">All Languages</option>
              {availableLanguages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>

          {/* Voice selection */}
          <div className="space-y-1 px-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Voice ({filteredVoices.length} available)
            </label>
            <select
              value={voiceURI}
              onChange={(e) => onVoiceChange(e.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              <option value="">Auto (first match)</option>
              {filteredVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang}){v.localService ? '' : ' [Network]'}
                </option>
              ))}
            </select>
          </div>

          {/* Rate slider */}
          <div className="space-y-1 px-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500 dark:text-gray-400">Speed</label>
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                {rate.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={rate}
              onChange={(e) => onRateChange(parseFloat(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>0.5x</span>
              <span>1.0x</span>
              <span>2.0x</span>
              <span>3.0x</span>
            </div>
          </div>

          {/* Pitch slider */}
          <div className="space-y-1 px-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500 dark:text-gray-400">Pitch</label>
              <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                {pitch.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={pitch}
              onChange={(e) => onPitchChange(parseFloat(e.target.value))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>Low</span>
              <span>Normal</span>
              <span>High</span>
            </div>
          </div>

          {/* Test / Stop button */}
          <div className="px-1">
            <button
              type="button"
              onClick={isSpeaking ? onStop : onTestVoice}
              className={`flex w-full items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isSpeaking
                  ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50'
              }`}
            >
              {isSpeaking ? (
                <>
                  <VolumeX className="h-4 w-4" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Test Voice
                </>
              )}
            </button>
          </div>
        </>
      )}
    </QuickSettingsSection>
  );
}
