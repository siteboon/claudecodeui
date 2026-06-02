import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';

import { authenticatedFetch } from '../../../utils/api';

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

export default function PluginIcon({ pluginName, iconFile, className }: Props) {
  const url = iconFile
    ? `/api/plugins/${encodeURIComponent(pluginName)}/assets/${encodeURIComponent(iconFile)}`
    : '';
  const [svg, setSvg] = useState<string | null>(url ? (svgCache.get(url) ?? null) : null);

  useEffect(() => {
    if (!url || svgCache.has(url)) return;
    authenticatedFetch(url)
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
  }, [url]);

  if (!svg) return <span className={className} />;

  return (
    <span className={className} dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
