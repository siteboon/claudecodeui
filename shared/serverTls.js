import crypto from 'node:crypto';
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
 * fs messages end with the path ("ENOENT: no such file or directory, open '<path>'"). The warning
 * names the path already, so keep only the code and its description.
 *
 * @param {unknown} error
 * @returns {string}
 */
function describeReadError(error) {
  const code = /** @type {NodeJS.ErrnoException} */ (error)?.code;
  return typeof code === 'string' ? describeError(error).split(', ')[0] : describeError(error);
}

/**
 * Reads one SSL_* variable. One pair of surrounding quotes is dropped because Vite's loadEnv strips
 * them from .env values while server/load-env.ts keeps them, and both must pick the same file.
 *
 * @param {Record<string, string | undefined>} env
 * @param {'SSL_CERT' | 'SSL_KEY'} name
 * @returns {string}
 */
function readPathSetting(env, name) {
  const value = env[name]?.trim() || '';
  const isQuoted = value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0];
  return isQuoted ? value.slice(1, -1).trim() : value;
}

/**
 * SSL_CERT/SSL_KEY take file paths, but secrets are often pasted in as PEM text (or base64 of it).
 * Such a value must never reach a log line: for SSL_KEY it is the private key itself.
 *
 * @param {string} value
 * @returns {boolean}
 */
function looksLikePemText(value) {
  return value.includes('\n') || value.includes('-----BEGIN') || value.startsWith('LS0tLS1CRUdJT');
}

/**
 * Single-line secret stores often hold a key as its bare base64 body, without the BEGIN/END lines,
 * which looksLikePemText() does not catch. Only asked once reading the setting as a file has
 * failed, so a real path is never refused. Base64 has no '.', which almost every real path has; a
 * missing path of 40+ characters without one is held back too, which only costs the path in the
 * warning.
 *
 * @param {string} value
 * @returns {boolean}
 */
function looksLikeEncodedData(value) {
  return /^[A-Za-z0-9+/=_-]{40,}$/.test(value.replace(/\s|\\[nr]/g, ''));
}

/**
 * Decides whether the backend, and the Vite dev server in front of it, serve HTTPS.
 * Used by server/index.ts, vite.config.js, the browser-use module (its loopback MCP URL) and
 * `cloudcli status`, so they all agree on the protocol.
 *
 * - Neither SSL_CERT nor SSL_KEY set: plain HTTP with no warning (the default).
 * - Both set, both files readable, and the key loads with the certificate and belongs to it: HTTPS.
 * - Anything else (only one variable set, a missing or unreadable file, a file that is not PEM,
 *   a passphrase-protected key, or a key that does not belong to the certificate): plain HTTP and
 *   a warning that names the variable, the path and the reason. The warning never contains file
 *   contents, and a variable that holds PEM text or encoded key data instead of a path is named
 *   but not echoed.
 * - CLOUDCLI_DISABLE_SSL=1 (set by the desktop app for its own server): plain HTTP, with a
 *   warning only if SSL_CERT/SSL_KEY are set, so the user sees why they were ignored.
 *
 * Relative paths resolve against the current working directory.
 *
 * @param {Record<string, string | undefined>} env process.env, or the env object from Vite's loadEnv()
 * @returns {ServerTls}
 */
export function resolveServerTls(env) {
  const certSetting = readPathSetting(env, 'SSL_CERT');
  const keySetting = readPathSetting(env, 'SSL_KEY');
  if (!certSetting && !keySetting) {
    return { protocol: 'http', warning: null };
  }
  if (env[DISABLE_SSL_ENV_KEY] === '1') {
    return httpFallback(
      `SSL_CERT/SSL_KEY are ignored because ${DISABLE_SSL_ENV_KEY}=1 (the desktop app sets it for the server it starts).`,
    );
  }
  // Checked before any message below echoes a setting.
  if (looksLikePemText(certSetting)) {
    return httpFallback('SSL_CERT holds PEM text, not a file path. Set it to the path of the certificate file.');
  }
  if (looksLikePemText(keySetting)) {
    return httpFallback('SSL_KEY holds PEM text, not a file path. Set it to the path of the private key file.');
  }
  // The value that is set is not echoed: it has not been read as a file yet, so it may be key data.
  if (!certSetting) {
    return httpFallback('SSL_KEY is set but SSL_CERT is not. HTTPS needs both SSL_CERT and SSL_KEY.');
  }
  if (!keySetting) {
    return httpFallback('SSL_CERT is set but SSL_KEY is not. HTTPS needs both SSL_CERT and SSL_KEY.');
  }

  const certPath = path.resolve(certSetting);
  const keyPath = path.resolve(keySetting);

  let cert;
  try {
    cert = fs.readFileSync(certPath);
  } catch (error) {
    if (looksLikeEncodedData(certSetting)) {
      return httpFallback(
        'SSL_CERT does not name a readable file (value not shown because it may contain key or '
          + 'certificate data). Set it to the path of the certificate file.',
      );
    }
    return httpFallback(`SSL_CERT file ${certPath} could not be read: ${describeReadError(error)}`);
  }

  let key;
  try {
    key = fs.readFileSync(keyPath);
  } catch (error) {
    if (looksLikeEncodedData(keySetting)) {
      return httpFallback(
        'SSL_KEY does not name a readable file (value not shown because it may contain key data). '
          + 'Set it to the path of the private key file.',
      );
    }
    return httpFallback(`SSL_KEY file ${keyPath} could not be read: ${describeReadError(error)}`);
  }

  // Load each file on its own first so the warning can say which one is broken, then the pair.
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
  // OpenSSL only compares a key with the certificate when both are the same type, so an RSA key
  // next to an ECDSA certificate (or the reverse) loads above and then fails every handshake.
  // X509Certificate reads the first certificate in the file, which is the one TLS serves.
  try {
    const certificate = new crypto.X509Certificate(cert);
    const privateKey = crypto.createPrivateKey(key);
    if (!certificate.checkPrivateKey(privateKey)) {
      const certKeyType = certificate.publicKey.asymmetricKeyType;
      const reason = certKeyType === privateKey.asymmetricKeyType
        ? 'the private key does not belong to the certificate'
        : `the certificate's key type is ${certKeyType}, the private key's is ${privateKey.asymmetricKeyType}`;
      return httpFallback(`SSL_KEY file ${keyPath} does not match SSL_CERT file ${certPath}: ${reason}`);
    }
  } catch (error) {
    return httpFallback(
      `SSL_KEY file ${keyPath} could not be checked against SSL_CERT file ${certPath}: ${describeError(error)}`,
    );
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
