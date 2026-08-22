/**
 * Browser download helpers.
 *
 * Downloads must be started from a synthetic anchor click, and the blob URL
 * must outlive that click: revoking it in the same tick races the browser's
 * download manager and silently drops the download.
 */

function clickDownloadAnchor(href: string, fileName?: string): void {
  const anchor = document.createElement('a');
  anchor.href = href;
  if (fileName) {
    anchor.download = fileName;
  }

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/**
 * Starts a native download from a URL. The response streams straight to disk,
 * so the browser owns progress, cancellation, and resume.
 */
export function triggerDownload(href: string, fileName?: string): void {
  clickDownloadAnchor(href, fileName);
}

/**
 * Saves an in-memory blob. Prefer `triggerDownload` for anything the server can
 * serve directly; this is for content the page itself generated.
 */
export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const blobUrl = URL.createObjectURL(blob);
  clickDownloadAnchor(blobUrl, fileName);
  // Deferred so the download manager has the URL before it is revoked.
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}
