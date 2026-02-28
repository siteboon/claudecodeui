import React from 'react';

type SkillInfoTooltipProps = {
  info: {
    commandName: string;
    description?: string;
    compatibility?: string;
    metadata?: Record<string, unknown>;
    argumentHint?: string;
    allowedTools?: string[];
  };
};

const formatMetadata = (metadata?: Record<string, unknown>): string | null => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }

  const cleaned = { ...metadata };
  delete cleaned.description;
  delete cleaned.compatibility;
  delete cleaned['argument-hint'];
  delete cleaned.argumentHint;
  delete cleaned['allowed-tools'];
  delete cleaned.allowedTools;

  if (Object.keys(cleaned).length === 0) {
    return null;
  }

  try {
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return null;
  }
};

export default function SkillInfoTooltip({ info }: SkillInfoTooltipProps) {
  const metadataText = formatMetadata(info.metadata);

  return (
    <div className="pointer-events-auto fixed left-1/2 top-3 z-[1200] max-h-[min(60vh,420px)] w-[min(92vw,560px)] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-xl border border-border/60 bg-card/95 px-4 py-3 text-xs shadow-xl backdrop-blur-sm select-text">
      <div className="mb-1 text-sm font-semibold text-foreground">{info.commandName}</div>

      {info.description && (
        <div className="mb-1">
          <span className="font-medium text-foreground">description: </span>
          <span className="text-muted-foreground">{info.description}</span>
        </div>
      )}

      {info.compatibility && (
        <div className="mb-1">
          <span className="font-medium text-foreground">compatibility: </span>
          <span className="text-muted-foreground">{info.compatibility}</span>
        </div>
      )}

      {info.argumentHint && (
        <div className="mb-1">
          <span className="font-medium text-foreground">argument-hint: </span>
          <span className="text-muted-foreground font-mono">{info.argumentHint}</span>
        </div>
      )}

      {info.allowedTools && info.allowedTools.length > 0 && (
        <div className="mb-1">
          <span className="font-medium text-foreground">allowed-tools: </span>
          <span className="text-muted-foreground">{info.allowedTools.join(', ')}</span>
        </div>
      )}

      {metadataText && (
        <div>
          <div className="font-medium text-foreground mb-1">metadata:</div>
          <pre
            className="pointer-events-auto max-h-32 overflow-auto overscroll-contain rounded-md bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-words select-text"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {metadataText}
          </pre>
        </div>
      )}
    </div>
  );
}
