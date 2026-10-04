import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_RATE_WINDOW_MS = 5 * 60 * 1000;
const TOTP_MAX_FAILURES_PER_WINDOW = 6;

const totpFailureBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Encodes a binary Buffer into an RFC 4648 Base32 string without padding.
 */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a raw binary Buffer.
 */
export function base32Decode(base32Str: string): Buffer {
  const cleaned = String(base32Str || '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/**
 * Generates a cryptographically random Base32-encoded TOTP secret.
 */
export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

/**
 * Generates single-use human-readable recovery backup codes (XXXX-XXXX).
 */
export function generateBackupCodes(count = 6): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

/**
 * Computes a 6-digit RFC 4226 HOTP token for the given Base32 secret and counter.
 */
export function computeHotp(secretBase32: string, counter: number): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  let tmp = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(tmp & 0xffn);
    tmp >>= 8n;
  }
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * Returns the 6-digit RFC 6238 TOTP code for the specified timestamp.
 */
export function getCurrentTotpCode(
  secretBase32: string,
  timestampMs = Date.now(),
  stepSeconds = 30,
): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  return computeHotp(secretBase32, counter);
}

/**
 * Verifies a 6-digit RFC 6238 TOTP code within the allowed time-step window.
 */
export function verifyTotpCode(
  secretBase32: string,
  codeInput: string,
  windowSteps = 1,
  stepSeconds = 30,
): boolean {
  if (!secretBase32 || !codeInput) return false;
  const normalized = String(codeInput).replace(/\s|-/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  const currentCounter = Math.floor(Date.now() / 1000 / stepSeconds);
  for (let w = -windowSteps; w <= windowSteps; w++) {
    const expected = computeHotp(secretBase32, currentCounter + w);
    if (expected === normalized) {
      return true;
    }
  }
  return false;
}

/**
 * Verifies a 6-digit TOTP code or atomically consumes a single-use backup code.
 * Fails closed if durable persistence of the consumed backup code fails.
 */
export function verifyTotpOrConsumeBackupCode(
  db: Database.Database | undefined,
  userId: number,
  secretBase32: string,
  backupCodesJson: string | null | undefined,
  codeInput: string,
): { valid: boolean; method: 'rfc6238-totp' | 'backup-code' | null } {
  const trimmed = String(codeInput || '').trim();
  if (!trimmed || !secretBase32) {
    return { valid: false, method: null };
  }

  if (verifyTotpCode(secretBase32, trimmed, 1)) {
    return { valid: true, method: 'rfc6238-totp' };
  }

  if (!backupCodesJson || !db) {
    return { valid: false, method: null };
  }

  let backups: unknown;
  try {
    backups = JSON.parse(backupCodesJson);
  } catch {
    return { valid: false, method: null };
  }

  if (!Array.isArray(backups)) {
    return { valid: false, method: null };
  }

  const normalizedInput = trimmed.toUpperCase().replace(/\s/g, '');
  const idx = backups.findIndex((c) => String(c).toUpperCase() === normalizedInput);
  if (idx === -1) {
    return { valid: false, method: null };
  }

  const remaining = [...backups];
  remaining.splice(idx, 1);

  try {
    const result = db
      .prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
      .run(JSON.stringify(remaining), userId);

    if (!result || result.changes < 1) {
      return { valid: false, method: null };
    }
  } catch {
    return { valid: false, method: null };
  }

  return { valid: true, method: 'backup-code' };
}

/**
 * Builds a standard otpauth://totp/ URI for authenticator apps.
 */
export function buildOtpAuthUri(
  username: string,
  secretBase32: string,
  issuer = 'CloudCLI',
): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(username)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Generates a Data URL PNG image for the provided otpauth URI when the qrcode module is available.
 */
export async function generateQrCodeDataUrl(text: string): Promise<string | null> {
  try {
    const QRCode = require('qrcode') as {
      toDataURL(
        input: string,
        opts: Record<string, unknown>,
      ): Promise<string>;
    };
    return await QRCode.toDataURL(text, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 220,
      color: { dark: '#111827', light: '#ffffff' },
    });
  } catch {
    return null;
  }
}

/**
 * Ensures the SQLite `users` table (when present) includes the columns needed for
 * active and pending TOTP 2FA enrollment. Safe to call before or after schema bootstrap.
 */
export function ensureTotpSchema(db?: Database.Database): void {
  if (!db) return;

  const usersTableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();

  if (!usersTableExists) {
    return;
  }

  const columns = (
    db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
  ).map((c) => c.name);

  if (!columns.includes('totp_secret')) {
    db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT NULL');
  }
  if (!columns.includes('totp_enabled')) {
    db.exec('ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0');
  }
  if (!columns.includes('totp_backup_codes')) {
    db.exec('ALTER TABLE users ADD COLUMN totp_backup_codes TEXT DEFAULT NULL');
  }
  if (!columns.includes('totp_pending_secret')) {
    db.exec('ALTER TABLE users ADD COLUMN totp_pending_secret TEXT DEFAULT NULL');
  }
  if (!columns.includes('totp_pending_backup_codes')) {
    db.exec('ALTER TABLE users ADD COLUMN totp_pending_backup_codes TEXT DEFAULT NULL');
  }
}

/**
 * Checks whether an account or client IP has exceeded the allowed number of failed
 * authentication/TOTP attempts within the 5-minute rate-limit window.
 */
export function isTotpRateLimited(...keys: Array<string | undefined>): boolean {
  const now = Date.now();
  if (totpFailureBuckets.size > 2000) {
    for (const [k, v] of totpFailureBuckets.entries()) {
      if (v.resetAt <= now) {
        totpFailureBuckets.delete(k);
      }
    }
  }

  for (const key of keys) {
    if (!key) continue;
    const bucket = totpFailureBuckets.get(key);
    if (bucket && bucket.resetAt > now && bucket.count >= TOTP_MAX_FAILURES_PER_WINDOW) {
      return true;
    }
  }
  return false;
}

/**
 * Records a failed authentication/TOTP attempt against the provided rate-limit keys.
 */
export function recordTotpFailure(...keys: Array<string | undefined>): void {
  const now = Date.now();
  for (const key of keys) {
    if (!key) continue;
    const bucket = totpFailureBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      totpFailureBuckets.set(key, { count: 1, resetAt: now + TOTP_RATE_WINDOW_MS });
    } else {
      bucket.count += 1;
    }
  }
}

/**
 * Clears recorded authentication/TOTP failure counts for the provided keys upon successful verification.
 */
export function clearTotpFailures(...keys: Array<string | undefined>): void {
  for (const key of keys) {
    if (key) {
      totpFailureBuckets.delete(key);
    }
  }
}
