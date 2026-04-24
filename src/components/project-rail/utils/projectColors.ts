export type ProjectColorKey =
  | 'default'
  | 'eucalyptus'
  | 'pink'
  | 'amber'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'red'
  | 'slate';

export interface ProjectColor {
  key: ProjectColorKey;
  label: string;
  hex: string;
  fg: string;
}

export const PROJECT_PALETTE_ORDER: ProjectColorKey[] = [
  'eucalyptus',
  'pink',
  'amber',
  'teal',
  'blue',
  'purple',
  'red',
  'slate',
];

export const PROJECT_PALETTE: Record<ProjectColorKey, ProjectColor> = {
  default: { key: 'default', label: 'Default', hex: '#2bb28d', fg: '#062818' },
  eucalyptus: { key: 'eucalyptus', label: 'Eucalyptus', hex: '#2bb28d', fg: '#062818' },
  pink: { key: 'pink', label: 'Pink', hex: '#ff5c8a', fg: '#2a0018' },
  amber: { key: 'amber', label: 'Amber', hex: '#f5b042', fg: '#2a1400' },
  teal: { key: 'teal', label: 'Teal', hex: '#2dd4bf', fg: '#002a28' },
  blue: { key: 'blue', label: 'Blue', hex: '#5c8cff', fg: '#000f2a' },
  purple: { key: 'purple', label: 'Purple', hex: '#a965ff', fg: '#12002a' },
  red: { key: 'red', label: 'Red', hex: '#f56565', fg: '#2a0005' },
  slate: { key: 'slate', label: 'Slate', hex: '#8aa1b8', fg: '#0b1320' },
};

export function getProjectColor(key: ProjectColorKey | undefined | null): ProjectColor {
  if (!key || !PROJECT_PALETTE[key]) return PROJECT_PALETTE.default;
  return PROJECT_PALETTE[key];
}

export function softAccent(hex: string, alpha = 0.14): string {
  return `color-mix(in srgb, ${hex} ${Math.round(alpha * 100)}%, transparent)`;
}
