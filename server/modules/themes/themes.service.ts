import { AppError } from '@/shared/utils.js';

/**
 * Downloads a VS Code theme extension on the browser's behalf.
 *
 * The client does the parsing and the colour mapping; this exists only because
 * the browser cannot fetch the archive itself. The Visual Studio Marketplace
 * sends no `Access-Control-Allow-Origin`, so a page-level fetch is blocked
 * outright, and both registries answer a page URL with HTML rather than a
 * `.vsix` — the download URL has to be resolved first.
 *
 * Every hop is checked against a host allowlist: this endpoint takes a URL from
 * an authenticated user and fetches it from inside the network the server runs
 * in, which is exactly the shape of a server-side request forgery unless the
 * destination is constrained.
 */

/** Where a downloaded extension came from, so the caller can name the file. */
export type ThemeExtensionDownload = {
  data: Buffer;
  fileName: string;
};

type ThemeGalleryDependencies = {
  fetch: typeof globalThis.fetch;
  /** The download ceiling, overridable so a test can trip it without moving 60 MB. */
  maxDownloadBytes?: number;
};

/** The registries a URL may point at, and what identifies an extension in each. */
type GalleryReference =
  | { registry: 'marketplace'; publisher: string; name: string }
  | { registry: 'open-vsx'; namespace: string; name: string }
  | { registry: 'direct'; url: string };

/**
 * Hosts the download may touch, including the CDNs both registries redirect to.
 * `open-vsx.org` hands its files to `openvsx.eclipsecontent.org`, and the
 * Marketplace to a per-publisher `*.gallerycdn.vsassets.io` bucket.
 */
const ALLOWED_HOSTS = new Set([
  'marketplace.visualstudio.com',
  'open-vsx.org',
  'openvsx.eclipsecontent.org',
]);

const ALLOWED_HOST_SUFFIXES = ['.gallerycdn.vsassets.io'];

/** Matches the client's own ceiling for a `.vsix`, so a rejection is consistent on both sides. */
const MAX_DOWNLOAD_BYTES = 60_000_000;

/** Long enough for a large extension on a slow link, short enough not to pin a request open. */
const DOWNLOAD_TIMEOUT_MS = 30_000;

/** Registries redirect once or twice to a CDN; more than this is a loop. */
const MAX_REDIRECTS = 5;

/** Creates the theme-gallery workflows with an explicit fetch adapter. */
export function createThemeGalleryService(dependencies: ThemeGalleryDependencies) {
  const maxDownloadBytes = dependencies.maxDownloadBytes ?? MAX_DOWNLOAD_BYTES;

  const tooLarge = () => new AppError('That extension is too large to import', {
    code: 'THEME_EXTENSION_TOO_LARGE',
    statusCode: 413,
  });

  const downloadFailed = () => new AppError('That extension could not be downloaded', {
    code: 'THEME_DOWNLOAD_FAILED',
    statusCode: 502,
  });

  /** Reads the registry's own metadata to turn an extension page into a file URL. */
  async function resolveDownloadUrl(reference: GalleryReference): Promise<string> {
    if (reference.registry === 'direct') {
      return reference.url;
    }

    if (reference.registry === 'marketplace') {
      // `latest` is resolved by the gallery itself, which saves a metadata call.
      return 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/'
        + `${encodeURIComponent(reference.publisher)}/vsextensions/`
        + `${encodeURIComponent(reference.name)}/latest/vspackage`;
    }

    const metadataUrl = 'https://open-vsx.org/api/'
      + `${encodeURIComponent(reference.namespace)}/${encodeURIComponent(reference.name)}/latest`;
    const { response, release } = await fetchWithDeadline(metadataUrl);
    let metadata: { files?: { download?: unknown } };
    try {
      if (!response.ok) {
        throw new AppError('That extension could not be found on Open VSX', {
          code: 'THEME_EXTENSION_NOT_FOUND',
          statusCode: 404,
        });
      }
      metadata = (await response.json()) as { files?: { download?: unknown } };
    } finally {
      release();
    }
    const download = metadata.files?.download;
    if (typeof download !== 'string') {
      throw new AppError('That Open VSX extension publishes no downloadable package', {
        code: 'THEME_EXTENSION_NOT_DOWNLOADABLE',
        statusCode: 502,
      });
    }
    return download;
  }

  /**
   * Fetches one URL under a deadline the caller closes.
   *
   * The timer is handed back rather than cleared here because it has to stay
   * armed while the body is read: a response whose headers arrive promptly and
   * whose body then trickles would otherwise hold the request open forever.
   */
  async function fetchWithDeadline(url: string): Promise<{
    response: Response;
    controller: AbortController;
    release: () => void;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      // Redirects are followed by hand so every hop can be re-checked against
      // the allowlist; `redirect: 'follow'` would only ever show the last one.
      const response = await dependencies.fetch(url, {
        redirect: 'manual',
        signal: controller.signal,
      });
      return { response, controller, release: () => clearTimeout(timer) };
    } catch {
      clearTimeout(timer);
      throw downloadFailed();
    }
  }

  /**
   * Reads a body while counting it, so the ceiling is enforced on bytes actually
   * received rather than on a `Content-Length` the response is free to omit.
   */
  async function readWithinBudget(response: Response, controller: AbortController): Promise<Buffer> {
    const reader = response.body?.getReader();
    if (!reader) {
      // No stream to pull: buffering is the only option, and the same ceiling
      // still applies to what came back.
      const buffered = Buffer.from(await response.arrayBuffer());
      if (buffered.byteLength > maxDownloadBytes) {
        throw tooLarge();
      }
      return buffered;
    }

    const chunks: Buffer[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      received += value.byteLength;
      if (received > maxDownloadBytes) {
        // Stop pulling rather than discovering the size once it is all in memory.
        controller.abort();
        throw tooLarge();
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  async function download(startUrl: string): Promise<Buffer> {
    let url = assertAllowedUrl(startUrl);

    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const { response, controller, release } = await fetchWithDeadline(url);

      try {
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw downloadFailed();
          }
          url = assertAllowedUrl(new URL(location, url).toString());
          continue;
        }

        if (!response.ok) {
          throw downloadFailed();
        }

        // A declared length that is already over the ceiling saves pulling the
        // body at all; the streamed count below is what actually enforces it.
        if (Number(response.headers.get('content-length') ?? '0') > maxDownloadBytes) {
          throw tooLarge();
        }

        return await readWithinBudget(response, controller);
      } finally {
        release();
      }
    }

    throw new AppError('That extension redirected too many times', {
      code: 'THEME_DOWNLOAD_FAILED',
      statusCode: 502,
    });
  }

  return {
    /**
     * Fetches the `.vsix` a Marketplace or Open VSX URL points at.
     *
     * Accepts an extension page on either registry and a direct link to a
     * package on a host they serve from.
     */
    async downloadExtension(rawUrl: unknown): Promise<ThemeExtensionDownload> {
      const reference = parseGalleryReference(rawUrl);
      const downloadUrl = await resolveDownloadUrl(reference);
      return {
        data: await download(downloadUrl),
        fileName: `${referenceName(reference)}.vsix`,
      };
    },
  };
}

/** Reads an extension page URL, or a direct package link, into what identifies it. */
function parseGalleryReference(rawUrl: unknown): GalleryReference {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new AppError('A theme URL is required', {
      code: 'INVALID_THEME_URL',
      statusCode: 400,
    });
  }

  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new AppError('That is not a valid URL', {
      code: 'INVALID_THEME_URL',
      statusCode: 400,
    });
  }

  if (url.protocol !== 'https:') {
    throw new AppError('Only https URLs can be imported', {
      code: 'INVALID_THEME_URL',
      statusCode: 400,
    });
  }

  if (url.hostname === 'marketplace.visualstudio.com') {
    // The Marketplace addresses an extension as `?itemName=publisher.extension`.
    const itemName = url.searchParams.get('itemName') ?? '';
    const separator = itemName.indexOf('.');
    if (separator > 0) {
      return {
        registry: 'marketplace',
        publisher: itemName.slice(0, separator),
        name: itemName.slice(separator + 1),
      };
    }
  }

  if (url.hostname === 'open-vsx.org') {
    // Open VSX addresses an extension as `/extension/namespace/name`.
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] === 'extension' && segments[1] && segments[2]) {
      return { registry: 'open-vsx', namespace: segments[1], name: segments[2] };
    }
  }

  if (isAllowedHost(url.hostname)) {
    return { registry: 'direct', url: url.toString() };
  }

  throw new AppError(
    'Paste a Visual Studio Marketplace or Open VSX extension URL',
    { code: 'UNSUPPORTED_THEME_URL', statusCode: 400 },
  );
}

function referenceName(reference: GalleryReference): string {
  if (reference.registry === 'marketplace') {
    return reference.name;
  }
  if (reference.registry === 'open-vsx') {
    return reference.name;
  }
  const lastSegment = new URL(reference.url).pathname.split('/').filter(Boolean).at(-1);
  return (lastSegment ?? 'extension').replace(/\.vsix$/i, '');
}

function assertAllowedUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || !isAllowedHost(url.hostname)) {
    throw new AppError('That download was refused: it left the extension registries', {
      code: 'UNSUPPORTED_THEME_URL',
      statusCode: 400,
    });
  }
  return url.toString();
}

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.has(host) || ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}
