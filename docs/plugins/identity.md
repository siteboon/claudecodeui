# Plugin user identity

The host authenticates every request before it reaches a plugin, but it never
shares its JWT secret or the session token with plugin processes: the
`Authorization` header is not forwarded and a `?token=` query parameter is
stripped from the proxied URL. Instead it forwards the authenticated user to the
plugin as a small HMAC-signed payload that the plugin can verify statelessly
with a key only it and the host know.

Plugins that do not read the key or the headers are unaffected: the headers are
additive, the manifest schema is unchanged, and nothing needs to be enabled.

## What the plugin receives

### `PLUGIN_IDENTITY_KEY` (environment variable)

Set on the plugin server subprocess when the host spawns it, next to
`PLUGIN_NAME`. It is the hex encoding of the plugin's 32-byte signing key.

```
PLUGIN_IDENTITY_KEY=3f9c…e1   # 64 hex characters
```

Read it once at startup. The key is derived from the host secret and the plugin
name, so it is stable across restarts for as long as the host's `JWT_SECRET`
and the plugin's `name` do not change. Renaming the plugin rotates its key.

### Identity headers

Every proxied HTTP RPC request (`/api/plugins/<name>/rpc/*`) and every proxied
WebSocket upgrade (`/plugin-ws/<name>`) carries three headers whenever the
calling user is authenticated:

| Header (lower-case on the wire) | Value |
| --- | --- |
| `x-plugin-user-payload` | base64 of the UTF-8 JSON payload below |
| `x-plugin-user-signature` | `sha256=<hex HMAC-SHA256(pluginKey, payloadJson)>` |
| `x-plugin-user-algorithm` | `sha256` |

Payload schema (the exact JSON string that was signed):

```ts
type PluginUserPayload = {
  userId: string | number; // the host user's id
  username: string;        // the host user's username
  iat: number;             // unix seconds when the host signed the payload
};
```

Both transports sit behind host authentication, so in practice every proxied
request carries the headers; in platform mode they name the host's single
configured user. They are only omitted if the host could not resolve a user at
all. The host builds the outgoing header set from scratch on every request, so a
client can never smuggle its own `x-plugin-user-*` values through to the plugin.

## Key derivation (host side)

```
pluginKey = HMAC-SHA256(key = JWT_SECRET, data = "plugin:" + pluginName)   // raw 32 bytes
PLUGIN_IDENTITY_KEY = hex(pluginKey)
signature = HMAC-SHA256(key = pluginKey, data = payloadJson)               // hex, prefixed "sha256="
```

`JWT_SECRET` never leaves the host process. A leaked plugin key cannot be used to
recover the host secret, to forge identity for a different plugin, or to mint
session tokens.

## Verifying on the plugin side

Copy this helper into your plugin server (Node 18+, no dependencies). It uses a
constant-time comparison, caps the payload size, and enforces a replay window:
payloads older than 60 seconds or more than 5 seconds in the future are
rejected. The window is enforced by the plugin, not the host; tighten it if your
plugin's operations are especially sensitive.

```js
import crypto from 'node:crypto';

const MAX_AGE_SECONDS = 60;
const MAX_FUTURE_SKEW_SECONDS = 5;

export function verifyPluginIdentity(headers, pluginKeyHex = process.env.PLUGIN_IDENTITY_KEY) {
  const payloadB64 = headers['x-plugin-user-payload'];
  const sigHeader = headers['x-plugin-user-signature'];
  const algo = headers['x-plugin-user-algorithm'];
  if (!pluginKeyHex || !payloadB64 || !sigHeader || algo !== 'sha256') return null;

  const [scheme, sigHex] = String(sigHeader).split('=');
  if (scheme !== 'sha256' || !sigHex) return null;

  // Cap payload size to bound parse cost. The host has no username length limit,
  // so leave ample room (Node itself rejects headers over 16 KiB).
  if (String(payloadB64).length > 8192) return null;

  const payloadStr = Buffer.from(payloadB64, 'base64').toString('utf-8');
  const expected = crypto
    .createHmac('sha256', Buffer.from(pluginKeyHex, 'hex'))
    .update(payloadStr)
    .digest();
  const got = Buffer.from(sigHex, 'hex');
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(got, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(payloadStr);
  } catch {
    return null;
  }
  if (typeof payload.iat === 'number') {
    const now = Math.floor(Date.now() / 1000);
    if (now - payload.iat > MAX_AGE_SECONDS) return null;
    if (payload.iat - now > MAX_FUTURE_SKEW_SECONDS) return null;
  }
  return { userId: payload.userId, username: payload.username };
}
```

### HTTP RPC

```js
import http from 'node:http';
import { verifyPluginIdentity } from './identity.js';

const server = http.createServer((req, res) => {
  const user = verifyPluginIdentity(req.headers);
  if (!user) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthenticated' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(user));
});
```

### WebSocket

With the `ws` library the upgrade headers are on the second argument of the
`connection` event:

```js
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (socket, request) => {
  const user = verifyPluginIdentity(request.headers);
  if (!user) {
    socket.close(4401, 'unauthenticated');
    return;
  }
  socket.send(JSON.stringify({ type: 'identity', user }));
});
```

The identity is bound to the upgrade, so verify it once per connection and keep
the result with the socket.

## Notes

- Identity answers "who is calling"; it does not grant permissions. The host is
  still the only writer for user records, and plugins that need to change them
  must go through host APIs.
- Do not log the raw payload or signature.
- Plugins running without a `server` entry, disabled plugins, and plugins that
  ignore these headers behave exactly as before.
