import { useState, useEffect, useId, useMemo } from 'react';
import DOMPurify from 'dompurify';

import { api } from '@/shared/api';

type Props = {
  pluginName: string;
  iconFile: string;
  className?: string;
};

// Module-level cache so repeated renders don't re-fetch
const svgCache = new Map<string, string>();

const FORBIDDEN_SVG_TAGS = [
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'style',
  'animate',
  'set',
  'animateTransform',
  'animateMotion',
];

const FORBIDDEN_SVG_ATTRS = [
  'href',
  'xlink:href',
  'src',
  'style',
];

function sanitizeSvg(svgText: string): string | null {
  const sanitized = DOMPurify.sanitize(svgText, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: FORBIDDEN_SVG_TAGS,
    FORBID_ATTR: FORBIDDEN_SVG_ATTRS,
  });

  if (!sanitized) return null;

  try {
    const doc = new DOMParser().parseFromString(sanitized, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
    if (doc.querySelector('parsererror')) return null;
    return sanitized;
  } catch {
    return null;
  }
}

/**
 * Suffixes every id in the SVG, and every `url(#id)` reference to one, with
 * `scope`. The same icon is often inlined several times on one page; with
 * shared ids each copy's masks and filters resolve to the first copy, which
 * breaks rendering when that copy is hidden.
 */
function scopeSvgIds(svg: string, scope: string): string {
  return svg
    .replace(/\bid="([^"]+)"/g, (_match, id: string) => `id="${id}-${scope}"`)
    .replace(/url\(#([^)]+)\)/g, (_match, id: string) => `url(#${id}-${scope})`);
}

/** Used by the project-workspace module's tab bar and by this module's PluginSettingsTab to show a plugin's icon. */
export default function PluginIcon({ pluginName, iconFile, className }: Props) {
  const url = iconFile ? api.plugins.assetUrl(pluginName, iconFile) : '';
  const [svg, setSvg] = useState<string | null>(url ? (svgCache.get(url) ?? null) : null);

  useEffect(() => {
    if (!iconFile || !url || svgCache.has(url)) return;
    api.plugins.asset(pluginName, iconFile)
      .then((r) => {
        if (!r.ok) return;
        return r.text();
      })
      .then((text) => {
        if (!text) return;
        const sanitized = sanitizeSvg(text);
        if (sanitized) {
          svgCache.set(url, sanitized);
          setSvg(sanitized);
        }
      })
      .catch(() => {});
  }, [url, pluginName, iconFile]);

  const scope = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const scopedSvg = useMemo(() => (svg ? scopeSvgIds(svg, scope) : null), [svg, scope]);

  if (!scopedSvg) return <span className={className} />;

  return (
    <span className={className} dangerouslySetInnerHTML={{ __html: scopedSvg }} />
  );
}
