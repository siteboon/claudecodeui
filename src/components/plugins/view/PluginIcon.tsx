import { useState, useEffect } from 'react';
import { authenticatedFetch } from '../../../utils/api';

type Props = {
  pluginName: string;
  iconFile: string;
  className?: string;
};

// Module-level cache so repeated renders don't re-fetch
const svgCache = new Map<string, string>();

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
        if (text && text.trimStart().startsWith('<svg')) {
          svgCache.set(url, text);
          setSvg(text);
        }
      })
      .catch(() => {});
  }, [url]);

  if (!svg) return <span className={className} />;

  return (
    <span
      className={className}
      // SVG is fetched from the user's own installed plugin — same trust level as the plugin code itself
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
