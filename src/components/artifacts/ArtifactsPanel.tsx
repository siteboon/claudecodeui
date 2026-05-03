import { useTranslation } from 'react-i18next';
import { X, Code, FileText, Paintbrush } from 'lucide-react';
import type { Artifact, ArtifactsPanelProps } from './types';

const TYPE_ICON: Record<Artifact['type'], typeof Code> = {
  code: Code,
  document: FileText,
  canvas: Paintbrush,
};

const TYPE_COLOR: Record<Artifact['type'], string> = {
  code: 'text-blue-500',
  document: 'text-green-500',
  canvas: 'text-purple-500',
};

export default function ArtifactsPanel({
  isOpen,
  onClose,
  artifacts,
  activeArtifactId,
  onSelectArtifact,
}: ArtifactsPanelProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-72 flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-semibold text-foreground">{t('artifacts.title')}</span>
        <button type="button" aria-label={t('artifacts.close')} onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-secondary">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {artifacts.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">{t('artifacts.empty')}</div>
        ) : (
          artifacts.map((artifact) => {
            const Icon = TYPE_ICON[artifact.type];
            const isActive = activeArtifactId === artifact.id;
            return (
              <button
                key={artifact.id}
                type="button"
                data-active={isActive}
                onClick={() => onSelectArtifact(artifact.id)}
                className={`flex w-full items-center gap-2.5 border-b border-border/50 px-3 py-2.5 text-left transition-colors hover:bg-secondary/50 ${isActive ? 'bg-secondary' : ''}`}
              >
                <span data-testid="artifact-type" className={TYPE_COLOR[artifact.type]}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{artifact.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {artifact.type}
                    {artifact.language && <> · <span>{artifact.language}</span></>}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
