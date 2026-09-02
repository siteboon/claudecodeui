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
