export type DetectedArtifactType = 'html' | 'svg' | 'react' | 'mermaid';

export interface DetectedArtifact {
  id: string;
  type: DetectedArtifactType;
  title: string;
  content: string;
}

const RENDERABLE_LANGUAGES: Record<string, DetectedArtifactType> = {
  html: 'html',
  svg: 'svg',
  jsx: 'react',
  tsx: 'react',
  mermaid: 'mermaid',
};

const TITLE_MAP: Record<DetectedArtifactType, string> = {
  html: 'HTML',
  svg: 'SVG',
  react: 'React Component',
  mermaid: 'Mermaid Diagram',
};

let counter = 0;
function generateId(): string {
  return `artifact-${Date.now()}-${++counter}`;
}

const CODE_BLOCK_RE = /```(\w+)\n([\s\S]*?)```/g;
const INLINE_SVG_RE = /<svg[\s\S]*?<\/svg>/gi;

export function detectArtifacts(text: string): DetectedArtifact[] {
  const artifacts: DetectedArtifact[] = [];
  const consumedRanges: [number, number][] = [];

  // Detect code blocks with renderable languages
  let match: RegExpExecArray | null;
  while ((match = CODE_BLOCK_RE.exec(text)) !== null) {
    const lang = match[1].toLowerCase();
    const type = RENDERABLE_LANGUAGES[lang];
    if (type) {
      artifacts.push({
        id: generateId(),
        type,
        title: TITLE_MAP[type],
        content: match[2].trim(),
      });
      consumedRanges.push([match.index, match.index + match[0].length]);
    }
  }

  // Detect inline SVGs not inside code blocks
  while ((match = INLINE_SVG_RE.exec(text)) !== null) {
    const pos = match.index;
    const inCodeBlock = consumedRanges.some(([start, end]) => pos >= start && pos < end);
    if (!inCodeBlock) {
      artifacts.push({
        id: generateId(),
        type: 'svg',
        title: TITLE_MAP.svg,
        content: match[0],
      });
    }
  }

  return artifacts;
}
