import { useState, useEffect } from 'react';
import { authenticatedFetch } from '../../../utils/api';

type Props = {
  pluginName: string;
  iconFile: string;
  className?: string;
};

// Module-level cache so repeated renders don't re-fetch
const svgCache = new Map<string, string>();

function sanitizeSvg(svgText: string): string | null {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return null;

    doc
      .querySelectorAll('script,foreignObject,iframe,object,embed,link,meta,style')
      .forEach((el) => el.remove());

    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const elements: Element[] = [root];
    while (walker.nextNode()) {
      elements.push(walker.currentNode as Element);
    }

    elements.forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (
          name.startsWith('on') ||
          name === 'href' ||
          name === 'xlink:href' ||
          value.startsWith('javascript:')
        ) {
          el.removeAttribute(attr.name);
        }
      });
    });

    return new XMLSerializer().serializeToString(root);
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
