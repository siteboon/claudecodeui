import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ImageLightbox } from '@/modules/chat/transcript/ChatMessageImages';
import type { ToolResultImage } from '@/modules/chat/utils/toolResultImages';

type ToolResultImagesProps = {
  images: ToolResultImage[];
};

/**
 * Images returned inside a tool result (screenshots, image reads, MCP image
 * content) shown as clickable thumbnails that expand to a fullscreen lightbox.
 *
 * Rendered by chat's ToolRenderer beneath a tool result's text so a base64
 * image block reads as a picture rather than a wall of base64 characters.
 */
export const ToolResultImages: React.FC<ToolResultImagesProps> = ({ images }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<number | null>(null);

  if (images.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {images.map((image, index) => {
        const src = `data:${image.mediaType};base64,${image.data}`;
        const alt = `Tool result image ${index + 1}`;
        return (
          <button
            key={index}
            type="button"
            onClick={() => setExpanded(index)}
            aria-label={t('chat:misc.expandImage', { name: alt })}
            className="block max-w-full overflow-hidden rounded-lg border border-gray-200/50 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/60 dark:border-gray-700/50 dark:bg-gray-800/50"
          >
            <img
              src={src}
              alt={alt}
              className="max-h-64 cursor-zoom-in rounded-lg object-contain"
            />
          </button>
        );
      })}
      {expanded !== null && (
        <ImageLightbox
          src={`data:${images[expanded].mediaType};base64,${images[expanded].data}`}
          alt={`Tool result image ${expanded + 1}`}
          onClose={() => setExpanded(null)}
        />
      )}
    </div>
  );
};
