import { useEffect, useState } from 'react';

import { api } from '@/shared/api';

// Shared by composers that mount together, so they make one request between them.
let limitRequest: Promise<number | null> | null = null;

function fetchAttachmentSizeLimit(): Promise<number | null> {
  if (limitRequest) {
    return limitRequest;
  }

  const request = api.assets.limits()
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }
      const body = await response.json().catch(() => null) as { maxFileSizeBytes?: unknown } | null;
      const limit = body?.maxFileSizeBytes;
      return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null;
    })
    .catch(() => null)
    .finally(() => {
      // Not cached past the request: the operator can change the limit and
      // restart the server while this page stays open.
      limitRequest = null;
    });
  limitRequest = request;
  return request;
}

/**
 * Used by the chat composer to reject attachments over the server's per-file
 * limit (CHAT_ATTACHMENT_MAX_SIZE_MB) before uploading them. Returns the limit
 * in bytes, or null until it has loaded or when it cannot be read; the server
 * still enforces the limit on upload either way.
 */
export function useAttachmentSizeLimit(): number | null {
  // The server's limit, read once per mount; there is no client-side copy to fall back to.
  const [maxFileSizeBytes, setMaxFileSizeBytes] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void fetchAttachmentSizeLimit().then((limit) => {
      if (active) {
        setMaxFileSizeBytes(limit);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return maxFileSizeBytes;
}
