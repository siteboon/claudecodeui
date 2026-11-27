import assert from 'node:assert/strict';
import test from 'node:test';

import { createThemeGalleryService } from '../themes.service.js';

/**
 * This endpoint fetches a user-supplied URL from inside the server's network,
 * so most of what matters here is what it refuses: anything off the two
 * registries, on the way in and on every redirect out.
 */

type FetchCall = { url: string; init?: RequestInit };

/** A fetch stub that records its calls and answers from a scripted map. */
function stubFetch(responses: Record<string, Response>) {
  const calls: FetchCall[] = [];
  const fetchStub = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const response = responses[url];
    if (!response) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return response;
  }) as typeof globalThis.fetch;

  return { fetchStub, calls };
}

const archive = () => new Response(Buffer.from('PK pretend archive'), { status: 200 });

const MARKETPLACE_PACKAGE = 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/'
  + 'zhuangtongfa/vsextensions/Material-theme/latest/vspackage';

test('resolves a Marketplace item URL to its package', async () => {
  const { fetchStub, calls } = stubFetch({ [MARKETPLACE_PACKAGE]: archive() });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const download = await service.downloadExtension(
    'https://marketplace.visualstudio.com/items?itemName=zhuangtongfa.Material-theme',
  );

  assert.equal(calls[0].url, MARKETPLACE_PACKAGE);
  assert.equal(download.fileName, 'Material-theme.vsix');
  assert.ok(download.data.byteLength > 0);
});

test('reads the download URL out of the Open VSX metadata', async () => {
  const metadataUrl = 'https://open-vsx.org/api/nebula-themes/nebula-aura-theme/latest';
  const fileUrl = 'https://open-vsx.org/api/nebula-themes/nebula-aura-theme/0.0.8/file/theme.vsix';
  const { fetchStub, calls } = stubFetch({
    [metadataUrl]: new Response(JSON.stringify({ files: { download: fileUrl } }), { status: 200 }),
    [fileUrl]: archive(),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const download = await service.downloadExtension(
    'https://open-vsx.org/extension/nebula-themes/nebula-aura-theme',
  );

  assert.deepEqual(calls.map((call) => call.url), [metadataUrl, fileUrl]);
  assert.equal(download.fileName, 'nebula-aura-theme.vsix');
});

test('follows a redirect that stays on the registries CDN', async () => {
  const cdnUrl = 'https://openvsx.eclipsecontent.org/nebula-themes/theme.vsix';
  const metadataUrl = 'https://open-vsx.org/api/nebula-themes/nebula-aura-theme/latest';
  const fileUrl = 'https://open-vsx.org/api/nebula-themes/nebula-aura-theme/0.0.8/file/theme.vsix';
  const { fetchStub, calls } = stubFetch({
    [metadataUrl]: new Response(JSON.stringify({ files: { download: fileUrl } }), { status: 200 }),
    [fileUrl]: new Response(null, { status: 302, headers: { location: cdnUrl } }),
    [cdnUrl]: archive(),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  await service.downloadExtension('https://open-vsx.org/extension/nebula-themes/nebula-aura-theme');

  assert.equal(calls.at(-1)?.url, cdnUrl);
});

test('refuses a redirect that leaves the registries', async () => {
  const metadataUrl = 'https://open-vsx.org/api/evil/theme/latest';
  const fileUrl = 'https://open-vsx.org/api/evil/theme/1.0.0/file/theme.vsix';
  const { fetchStub } = stubFetch({
    [metadataUrl]: new Response(JSON.stringify({ files: { download: fileUrl } }), { status: 200 }),
    // The shape of an SSRF: a registry URL bouncing to the server's own network.
    [fileUrl]: new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } }),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  await assert.rejects(
    () => service.downloadExtension('https://open-vsx.org/extension/evil/theme'),
    /left the extension registries/,
  );
});

test('refuses a URL that is not an extension page', async () => {
  const { fetchStub, calls } = stubFetch({});
  const service = createThemeGalleryService({ fetch: fetchStub });

  for (const url of [
    'https://example.com/theme.vsix',
    'http://marketplace.visualstudio.com/items?itemName=a.b',
    'file:///etc/passwd',
    'not a url',
    '',
  ]) {
    await assert.rejects(() => service.downloadExtension(url));
  }

  assert.equal(calls.length, 0, 'nothing may be fetched before the URL is accepted');
});

test('accepts a direct package link on a host the registries serve from', async () => {
  const directUrl = 'https://zhuangtongfa.gallerycdn.vsassets.io/extensions/zhuangtongfa/theme.vsix';
  const { fetchStub } = stubFetch({ [directUrl]: archive() });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const download = await service.downloadExtension(directUrl);

  assert.equal(download.fileName, 'theme.vsix');
});

test('stops a chunked response that never declares its length', async () => {
  // The shape the header check cannot catch: no Content-Length, bytes arriving
  // until memory gives out.
  const chunk = new Uint8Array(1024);
  const endless = new ReadableStream({
    pull(controller) {
      controller.enqueue(chunk);
    },
  });
  const { fetchStub } = stubFetch({
    [MARKETPLACE_PACKAGE]: new Response(endless, { status: 200 }),
  });
  const service = createThemeGalleryService({ fetch: fetchStub, maxDownloadBytes: 4096 });

  await assert.rejects(
    () => service.downloadExtension('https://marketplace.visualstudio.com/items?itemName=zhuangtongfa.Material-theme'),
    /too large/,
  );
});

test('refuses an extension larger than the import ceiling', async () => {
  const { fetchStub } = stubFetch({
    [MARKETPLACE_PACKAGE]: new Response(Buffer.from('PK'), {
      status: 200,
      headers: { 'content-length': String(80_000_000) },
    }),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  await assert.rejects(
    () => service.downloadExtension('https://marketplace.visualstudio.com/items?itemName=zhuangtongfa.Material-theme'),
    /too large/,
  );
});

/**
 * Search: Open VSX's `Themes` category mixes colour themes with icon themes, so
 * every candidate's manifest decides whether it is offered, and a published
 * version is only ever classified once.
 */

const SEARCH_URL = (query: string, sort = 'downloadCount') => {
  const url = new URL('https://open-vsx.org/api/-/search');
  url.searchParams.set('query', query);
  url.searchParams.set('category', 'Themes');
  url.searchParams.set('sortBy', sort);
  url.searchParams.set('sortOrder', 'desc');
  url.searchParams.set('size', '16');
  return url.toString();
};

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

/** Like stubFetch, but builds a fresh Response per call so a URL can be fetched twice. */
function routeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchStub = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (!route) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return route();
  }) as typeof globalThis.fetch;
  return { fetchStub, calls };
}

type Listed = { namespace: string; name: string; version?: string; icon?: string; deprecated?: boolean };

const listing = (entries: Listed[]) => ({
  extensions: entries.map(({ namespace, name, version = '1.0.0', icon, deprecated }) => ({
    namespace,
    name,
    version,
    displayName: `${name} display`,
    description: `${name} description`,
    downloadCount: 1234,
    deprecated: deprecated ?? false,
    files: { icon: icon ?? `https://open-vsx.org/api/${namespace}/${name}/${version}/file/icon.png` },
  })),
});

/** The detail and manifest routes for one extension version. */
function extensionRoutes(
  namespace: string,
  name: string,
  contributes: unknown,
  options: { version?: string; repository?: unknown; manifestUrl?: string } = {},
): Record<string, () => Response> {
  const version = options.version ?? '1.0.0';
  const manifestUrl = options.manifestUrl ?? `https://open-vsx.org/api/${namespace}/${name}/${version}/file/package.json`;
  return {
    [`https://open-vsx.org/api/${namespace}/${name}/${version}`]: () => json({
      files: { manifest: manifestUrl },
      repository: options.repository,
    }),
    [manifestUrl]: () => json({ contributes }),
  };
}

const COLOR_THEME = { themes: [{ label: 'Night', uiTheme: 'vs-dark', path: './themes/night.json' }] };
const ICON_THEME = { iconThemes: [{ id: 'icons', path: './icons.json' }] };

const BROWSE_URL = (sort = 'downloadCount') => {
  const url = new URL('https://open-vsx.org/api/-/search');
  url.searchParams.set('category', 'Themes');
  url.searchParams.set('sortBy', sort);
  url.searchParams.set('sortOrder', 'desc');
  url.searchParams.set('size', '32');
  return url.toString();
};

test('an empty search browses the category in the chosen order, without VS Code built-ins', async () => {
  const { fetchStub, calls } = routeFetch({
    [BROWSE_URL('timestamp')]: () => json(listing([
      { namespace: 'vscode', name: 'theme-red' },
      { namespace: 'acme', name: 'night-theme' },
    ])),
    ...extensionRoutes('acme', 'night-theme', COLOR_THEME),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const results = await service.searchThemes('   ', 'timestamp');

  assert.equal(calls[0], BROWSE_URL('timestamp'));
  assert.deepEqual(results.map((result) => result.id), ['acme.night-theme']);
  assert.ok(!calls.some((url) => url.includes('/vscode/')));
});

test('browsing skips tooling that merely bundles a theme, which a search still finds', async () => {
  const TOOLING = { ...COLOR_THEME, debuggers: [{ type: 'PowerShell' }] };
  const { fetchStub } = routeFetch({
    [BROWSE_URL()]: () => json(listing([{ namespace: 'ms-vscode', name: 'powershell' }, { namespace: 'acme', name: 'night-theme' }])),
    [SEARCH_URL('powershell')]: () => json(listing([{ namespace: 'ms-vscode', name: 'powershell' }])),
    ...extensionRoutes('ms-vscode', 'powershell', TOOLING),
    ...extensionRoutes('acme', 'night-theme', COLOR_THEME),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  assert.deepEqual((await service.searchThemes('', undefined)).map((result) => result.id), ['acme.night-theme']);
  assert.deepEqual((await service.searchThemes('powershell', undefined)).map((result) => result.id), ['ms-vscode.powershell']);
});

test('a search keeps VS Code built-ins, since the user asked for them by name', async () => {
  const { fetchStub } = routeFetch({
    [SEARCH_URL('solarized')]: () => json(listing([{ namespace: 'vscode', name: 'theme-solarized-dark' }])),
    ...extensionRoutes('vscode', 'theme-solarized-dark', COLOR_THEME),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const results = await service.searchThemes('solarized', undefined);

  assert.deepEqual(results.map((result) => result.id), ['vscode.theme-solarized-dark']);
});

test('a search offers only extensions whose manifest contributes colour themes', async () => {
  const { fetchStub, calls } = routeFetch({
    [SEARCH_URL('night')]: () => json(listing([
      { namespace: 'acme', name: 'night-theme' },
      { namespace: 'acme', name: 'night-icons' },
    ])),
    ...extensionRoutes('acme', 'night-theme', COLOR_THEME, { repository: 'git+https://github.com/acme/night.git' }),
    ...extensionRoutes('acme', 'night-icons', ICON_THEME),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const results = await service.searchThemes('night', undefined);

  assert.equal(calls[0], SEARCH_URL('night'));
  assert.deepEqual(results, [{
    id: 'acme.night-theme',
    namespace: 'acme',
    name: 'night-theme',
    displayName: 'night-theme display',
    description: 'night-theme description',
    downloadCount: 1234,
    version: '1.0.0',
    iconUrl: 'https://open-vsx.org/api/acme/night-theme/1.0.0/file/icon.png',
    sourceUrl: 'https://github.com/acme/night',
    url: 'https://open-vsx.org/extension/acme/night-theme',
  }]);
});

test('the requested sort order is passed through, and an unknown one is refused', async () => {
  const { fetchStub, calls } = routeFetch({
    [SEARCH_URL('nord', 'rating')]: () => json(listing([])),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  assert.deepEqual(await service.searchThemes('nord', 'rating'), []);
  assert.equal(calls[0], SEARCH_URL('nord', 'rating'));

  await assert.rejects(
    service.searchThemes('nord', 'averageRating'),
    (error: { code?: string; statusCode?: number }) => error.code === 'INVALID_THEME_SEARCH' && error.statusCode === 400,
  );
  await assert.rejects(
    service.searchThemes('x'.repeat(101), undefined),
    (error: { code?: string }) => error.code === 'INVALID_THEME_SEARCH',
  );
});

test('a published version is classified once, so a repeated search makes one request', async () => {
  const { fetchStub, calls } = routeFetch({
    [SEARCH_URL('dracula')]: () => json(listing([{ namespace: 'dracula-theme', name: 'theme-dracula' }])),
    ...extensionRoutes('dracula-theme', 'theme-dracula', COLOR_THEME),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  await service.searchThemes('dracula', undefined);
  const before = calls.length;
  const again = await service.searchThemes('dracula', undefined);

  assert.equal(before, 3);
  assert.deepEqual(calls.slice(before), [SEARCH_URL('dracula')]);
  assert.equal(again.length, 1);
});

test('deprecated extensions are skipped, and assets off the registries are not linked', async () => {
  const { fetchStub } = routeFetch({
    [SEARCH_URL('old')]: () => json(listing([
      { namespace: 'acme', name: 'old-theme', deprecated: true },
      { namespace: 'acme', name: 'new-theme', icon: 'https://tracker.example/icon.png' },
    ])),
    ...extensionRoutes('acme', 'new-theme', COLOR_THEME, { repository: 'http://github.com/acme/new' }),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const [result, ...rest] = await service.searchThemes('old', undefined);

  assert.equal(rest.length, 0);
  assert.equal(result.id, 'acme.new-theme');
  assert.equal(result.iconUrl, null);
  assert.equal(result.sourceUrl, null, 'a plain-http repository is not offered as a link');
});

test('a manifest the registry points off its own hosts is never fetched', async () => {
  const { fetchStub, calls } = routeFetch({
    [SEARCH_URL('sly')]: () => json(listing([
      { namespace: 'acme', name: 'sly-theme' },
      { namespace: 'acme', name: 'fine-theme' },
    ])),
    ...extensionRoutes('acme', 'sly-theme', COLOR_THEME, { manifestUrl: 'https://169.254.169.254/latest/meta-data' }),
    ...extensionRoutes('acme', 'fine-theme', COLOR_THEME),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const results = await service.searchThemes('sly', undefined);

  assert.deepEqual(results.map((result) => result.id), ['acme.fine-theme']);
  assert.ok(!calls.some((url) => url.includes('169.254.169.254')));
});

test('one extension whose details fail costs only its own card', async () => {
  const { fetchStub } = routeFetch({
    [SEARCH_URL('mix')]: () => json(listing([
      { namespace: 'acme', name: 'broken-theme' },
      { namespace: 'acme', name: 'working-theme' },
    ])),
    'https://open-vsx.org/api/acme/broken-theme/1.0.0': () => new Response('nope', { status: 500 }),
    ...extensionRoutes('acme', 'working-theme', COLOR_THEME),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const results = await service.searchThemes('mix', undefined);

  assert.deepEqual(results.map((result) => result.id), ['acme.working-theme']);
});

test('Open VSX failing outright is reported rather than shown as no results', async () => {
  const down = routeFetch({
    [SEARCH_URL('any')]: () => new Response('down', { status: 503 }),
  });
  await assert.rejects(
    createThemeGalleryService({ fetch: down.fetchStub }).searchThemes('any', undefined),
    (error: { code?: string; statusCode?: number }) => error.code === 'THEME_SEARCH_UNAVAILABLE' && error.statusCode === 502,
  );

  const detailsDown = routeFetch({
    [SEARCH_URL('any')]: () => json(listing([{ namespace: 'acme', name: 'a-theme' }])),
    'https://open-vsx.org/api/acme/a-theme/1.0.0': () => new Response('down', { status: 503 }),
  });
  await assert.rejects(
    createThemeGalleryService({ fetch: detailsDown.fetchStub }).searchThemes('any', undefined),
    (error: { code?: string }) => error.code === 'THEME_SEARCH_UNAVAILABLE',
  );
});

test('an oversized search response is refused instead of buffered', async () => {
  const { fetchStub } = routeFetch({
    [SEARCH_URL('huge')]: () => new Response('x'.repeat(600 * 1024), { status: 200 }),
  });

  await assert.rejects(
    createThemeGalleryService({ fetch: fetchStub }).searchThemes('huge', undefined),
    (error: { code?: string }) => error.code === 'THEME_SEARCH_UNAVAILABLE',
  );
});

test('a manifest served through the registry CDN is followed, one sent elsewhere is not', async () => {
  const cdnManifest = 'https://openvsx.eclipsecontent.org/acme/cdn-theme/1.0.0/package.json';
  const cdnRoutes = extensionRoutes('acme', 'cdn-theme', COLOR_THEME);
  const cdnManifestApi = 'https://open-vsx.org/api/acme/cdn-theme/1.0.0/file/package.json';
  const awayManifestApi = 'https://open-vsx.org/api/acme/away-theme/1.0.0/file/package.json';
  const { fetchStub, calls } = routeFetch({
    [SEARCH_URL('cdn')]: () => json(listing([
      { namespace: 'acme', name: 'cdn-theme' },
      { namespace: 'acme', name: 'away-theme' },
    ])),
    ...cdnRoutes,
    // Open VSX answers a file URL with a redirect to its CDN, as it does live.
    [cdnManifestApi]: () => new Response(null, { status: 302, headers: { location: cdnManifest } }),
    [cdnManifest]: () => json({ contributes: COLOR_THEME }),
    ...extensionRoutes('acme', 'away-theme', COLOR_THEME),
    [awayManifestApi]: () => new Response(null, { status: 302, headers: { location: 'https://evil.example/package.json' } }),
  });
  const service = createThemeGalleryService({ fetch: fetchStub });

  const results = await service.searchThemes('cdn', undefined);

  assert.deepEqual(results.map((result) => result.id), ['acme.cdn-theme']);
  assert.ok(calls.includes(cdnManifest));
  assert.ok(!calls.some((url) => url.includes('evil.example')));
});
