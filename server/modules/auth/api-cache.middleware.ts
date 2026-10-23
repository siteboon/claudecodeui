import type { NextFunction, Request, Response } from 'express';

// Used by the server entrypoint (server/index.ts), mounted on /api, so no API
// response is ever served from the browser's HTTP cache. Every API response may
// carry X-Refreshed-Token or X-Auth-Error, and a response the browser serves
// from its cache replays the headers it was stored with (#1308). #1549 taught
// authenticatedFetch to ignore replayed headers; this keeps the server from
// handing out cacheable auth material at all, which also covers plugins and any
// fetch that does not go through authenticatedFetch. Routes that stream (SSE)
// still set their own Cache-Control afterwards, as before.
export function noStoreApiResponses(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
