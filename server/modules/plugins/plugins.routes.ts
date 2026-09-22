import fs from 'node:fs';
import http from 'node:http';

import express from 'express';

import type { PluginIdentityUser } from '@/shared/types.js';

import type { createPluginsService } from './plugins.service.js';

type AuthenticatedRequest = express.Request & { user?: PluginIdentityUser };

function wildcardPath(req: express.Request): string {
  return ((req.params as Record<string, string>)['0'] ?? '').trim();
}

function routeParameter(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? '' : value;
}

/**
 * Query string to forward to the plugin. The session JWT may arrive as
 * `?token=` (auth.middleware accepts it for SSE-style clients), and it must no
 * more reach the plugin than the Authorization header does; every other
 * parameter is passed through verbatim.
 */
function forwardedQuery(url: string): string {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return '';
  const kept = url.slice(queryIndex + 1).split('&').filter((pair) => {
    const rawKey = pair.split('=')[0] ?? '';
    let key = rawKey;
    try { key = decodeURIComponent(rawKey.replace(/\+/g, ' ')); } catch { /* keep raw key */ }
    return key !== 'token';
  });
  return kept.length > 0 ? `?${kept.join('&')}` : '';
}

/** Creates plugin routes; transport streaming remains here while decisions live in the service. */
export function createPluginsRouter(service: ReturnType<typeof createPluginsService>): express.Router {
  const router = express.Router();
  const respond = (operation: (req: express.Request) => unknown | Promise<unknown>) =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try { res.json(await operation(req)); } catch (error) { next(error); }
    };

  router.get('/', respond(() => service.list()));
  router.get('/:name/manifest', respond((req) => service.getManifest(routeParameter(req.params.name))));
  router.get('/:name/assets/*', async (req, res, next) => {
    try {
      const asset = service.resolveAsset(routeParameter(req.params.name), wildcardPath(req));
      res.setHeader('Content-Type', asset.contentType);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const stream = fs.createReadStream(asset.path);
      stream.on('error', next);
      stream.pipe(res);
    } catch (error) { next(error); }
  });
  router.put('/:name/enable', respond((req) => service.setEnabled(routeParameter(req.params.name), req.body?.enabled)));
  router.post('/install', respond((req) => service.install(req.body?.url)));
  router.post('/:name/update', respond((req) => service.update(routeParameter(req.params.name))));
  router.all('/:name/rpc/*', async (req, res, next) => {
    try {
      const { port, secrets, identityHeaders } = await service.prepareRpc(
        routeParameter(req.params.name),
        (req as AuthenticatedRequest).user,
      );
      // Built from scratch on purpose: inbound x-plugin-user-* / x-plugin-secret-*
      // headers from the client must never reach the plugin.
      const headers: Record<string, string> = {
        'content-type': String(req.headers['content-type'] ?? 'application/json'),
        ...identityHeaders,
      };
      for (const [key, value] of Object.entries(secrets)) {
        headers[`x-plugin-secret-${key.toLowerCase()}`] = String(value);
      }
      const query = forwardedQuery(req.url);
      const proxyRequest = http.request({
        hostname: '127.0.0.1', port, path: `/${wildcardPath(req)}${query}`, method: req.method, headers,
      }, (proxyResponse) => {
        res.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
        proxyResponse.pipe(res);
      });
      proxyRequest.on('error', next);
      if (req.headers['content-length'] && req.body !== undefined) {
        const body = JSON.stringify(req.body);
        proxyRequest.setHeader('content-length', Buffer.byteLength(body));
        proxyRequest.write(body);
      }
      proxyRequest.end();
    } catch (error) { next(error); }
  });
  router.delete('/:name', respond((req) => service.uninstall(routeParameter(req.params.name))));
  return router;
}
