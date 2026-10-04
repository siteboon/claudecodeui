import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';

// The desktop app sets this for the server it starts itself. Its window, health checks and share
// links only use plain http:// on loopback, so SSL_CERT/SSL_KEY from the user's shell or .env must
// not switch that server to HTTPS.
const DISABLE_SSL_ENV_KEY = 'CLOUDCLI_DISABLE_SSL';

/**
 * @typedef {{ protocol: 'https', certPath: string, keyPath: string, cert: Buffer, key: Buffer }} HttpsServerTls
 * @typedef {{ protocol: 'http', warning: string | null }} HttpServerTls
 * @typedef {HttpsServerTls | HttpServerTls} ServerTls
 */

/**
 * @param {string} warning
 * @returns {HttpServerTls}
 */
function httpFallback(warning) {
  return { protocol: 'http', warning };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Decides whether the backend, and the Vite dev server in front of it, serve HTTPS.
 * Used by server/index.ts, vite.config.js, the browser-use module (its loopback MCP URL) and
 * `cloudcli status`, so they all agree on the protocol.
 *
 * - Neither SSL_CERT nor SSL_KEY set: plain HTTP with no warning (the default).
 * - Both set, both files readable and the pair loads into a TLS context: HTTPS.
 * - Anything else (only one variable set, a missing or unreadable file, a file that is not PEM,
 *   a passphrase-protected key, or a key that does not belong to the certificate): plain HTTP and
 *   a warning that names the variable, the path and the reason. The warning never contains file
 *   contents.
 *
 * Relative paths resolve against the current working directory.
 *
 * @param {Record<string, string | undefined>} env process.env, or the env object from Vite's loadEnv()
 * @returns {ServerTls}
 */
export function resolveServerTls(env) {
  if (env[DISABLE_SSL_ENV_KEY] === '1') {
    return { protocol: 'http', warning: null };
  }

  const certSetting = env.SSL_CERT?.trim() || '';
  const keySetting = env.SSL_KEY?.trim() || '';
  if (!certSetting && !keySetting) {
    return { protocol: 'http', warning: null };
  }
  if (!certSetting) {
    return httpFallback(`SSL_CERT is not set (SSL_KEY=${keySetting}). HTTPS needs both SSL_CERT and SSL_KEY.`);
  }
  if (!keySetting) {
    return httpFallback(`SSL_KEY is not set (SSL_CERT=${certSetting}). HTTPS needs both SSL_CERT and SSL_KEY.`);
  }

  const certPath = path.resolve(certSetting);
  const keyPath = path.resolve(keySetting);

  let cert;
  try {
    cert = fs.readFileSync(certPath);
  } catch (error) {
    return httpFallback(`SSL_CERT file ${certPath} could not be read: ${describeError(error)}`);
  }

  let key;
  try {
    key = fs.readFileSync(keyPath);
  } catch (error) {
    return httpFallback(`SSL_KEY file ${keyPath} could not be read: ${describeError(error)}`);
  }

  // Load each file on its own first so the warning can say which one is broken; the last step
  // catches a key that does not belong to the certificate.
  try {
    tls.createSecureContext({ cert });
  } catch (error) {
    return httpFallback(`SSL_CERT file ${certPath} is not a usable PEM certificate: ${describeError(error)}`);
  }
  try {
    tls.createSecureContext({ key });
  } catch (error) {
    return httpFallback(
      `SSL_KEY file ${keyPath} is not a usable unencrypted PEM private key: ${describeError(error)}`,
    );
  }
  try {
    tls.createSecureContext({ cert, key });
  } catch (error) {
    return httpFallback(`SSL_KEY file ${keyPath} does not match SSL_CERT file ${certPath}: ${describeError(error)}`);
  }

  return { protocol: 'https', certPath, keyPath, cert, key };
}

/**
 * Creates the backend's listening server for a resolveServerTls() result: an HTTPS server with
 * that certificate, or a plain HTTP server. The WebSocket gateway attaches to the returned server
 * either way, so ws:// becomes wss:// on the same port. Used by server/index.ts.
 *
 * @param {ServerTls} serverTls
 * @param {http.RequestListener} requestListener
 * @returns {http.Server}
 */
export function createServerForTls(serverTls, requestListener) {
  if (serverTls.protocol === 'https') {
    return https.createServer({ cert: serverTls.cert, key: serverTls.key }, requestListener);
  }
  return http.createServer(requestListener);
}
