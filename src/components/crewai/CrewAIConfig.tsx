import { useState } from 'react';

type CrewAIMode = 'local' | 'cloud' | 'hybrid';

type CrewAIConfigValues = {
  mode: CrewAIMode;
  localProjectPath: string;
  cloudApiKey: string;
  cloudEndpoint: string;
};

type CrewAIConfigProps = {
  onSave: (config: CrewAIConfigValues) => void;
  initialMode?: CrewAIMode;
  initialProjectPath?: string;
  initialCloudApiKey?: string;
  initialCloudEndpoint?: string;
};

export default function CrewAIConfig({
  onSave,
  initialMode = 'local',
  initialProjectPath = '',
  initialCloudApiKey = '',
  initialCloudEndpoint = '',
}: CrewAIConfigProps) {
  const [mode, setMode] = useState<CrewAIMode>(initialMode);
  const [localProjectPath, setLocalProjectPath] = useState(initialProjectPath);
  const [cloudApiKey, setCloudApiKey] = useState(initialCloudApiKey);
  const [cloudEndpoint, setCloudEndpoint] = useState(initialCloudEndpoint);

  const showProjectPath = mode === 'local' || mode === 'hybrid';
  const showCloudFields = mode === 'cloud' || mode === 'hybrid';

  function handleSave() {
    onSave({ mode, localProjectPath, cloudApiKey, cloudEndpoint });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-background p-4">
      <div>
        <label htmlFor="crewai-mode" className="mb-1 block text-sm font-medium">
          Mode
        </label>
        <select
          id="crewai-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as CrewAIMode)}
          className="w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm"
        >
          <option value="local">Local</option>
          <option value="cloud">Cloud</option>
          <option value="hybrid">Hybrid</option>
        </select>
      </div>

      {showProjectPath && (
        <div>
          <label htmlFor="crewai-project-path" className="mb-1 block text-sm font-medium">
            Project Path
          </label>
          <input
            id="crewai-project-path"
            type="text"
            value={localProjectPath}
            onChange={(e) => setLocalProjectPath(e.target.value)}
            placeholder="/path/to/crewai/project"
            className="w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm"
          />
        </div>
      )}

      {showCloudFields && (
        <div>
          <label htmlFor="crewai-api-key" className="mb-1 block text-sm font-medium">
            API Key
          </label>
          <input
            id="crewai-api-key"
            type="password"
            value={cloudApiKey}
            onChange={(e) => setCloudApiKey(e.target.value)}
            placeholder="CrewAI Plus API key"
            className="w-full rounded-md border border-border bg-muted px-3 py-1.5 text-sm"
          />
        </div>
      )}

      <button
        type="button"
        onClick={handleSave}
        className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Save
      </button>
    </div>
  );
}
