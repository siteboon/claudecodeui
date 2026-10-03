import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type express from 'express';

const require = createRequire(import.meta.url);
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const AUDIT_JSONL_PATH = path.join(os.homedir(), '.cloudcli', 'security-audit.jsonl');

export type AuditSeverity = 'INFO' | 'WARN' | 'CRITICAL';

export type RequestSecurityMeta = {
  ip?: string;
  userAgent?: string;
  method?: string;
  path?: string;
};

export type AuditEventInput = RequestSecurityMeta & {
  eventType: string;
  severity?: AuditSeverity;
  username?: string | null;
  userId?: number | bigint | null;
  statusCode?: number | null;
  details?: Record<string, unknown> | string | null;
};

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

export function generateTotpSecret(byteLength = 20): string {
  return base32Encode(crypto.randomBytes(byteLength));
}

export function generateBackupCodes(count = 6): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

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

export function getCurrentTotpCode(
  secretBase32: string,
  timestampMs = Date.now(),
  stepSeconds = 30,
): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  return computeHotp(secretBase32, counter);
}

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

export function ensureSecuritySchema(db?: Database.Database): void {
  if (!db) return;
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'INFO',
      username TEXT,
      user_id INTEGER,
      ip_address TEXT,
      user_agent TEXT,
      method TEXT,
      path TEXT,
      status_code INTEGER,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_ip ON audit_logs(ip_address);
  `);
}

export function normalizeIp(rawIp: unknown): string {
  if (!rawIp) return 'unknown';
  const first = String(rawIp).split(',')[0].trim();
  return first.startsWith('::ffff:') ? first.slice(7) : first;
}

export function extractRequestMeta(req?: express.Request): RequestSecurityMeta {
  if (!req) {
    return { ip: 'local', userAgent: 'internal', method: 'INTERNAL', path: '/' };
  }
  const rawIp =
    req.headers?.['x-forwarded-for'] ||
    req.headers?.['x-real-ip'] ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown';
  return {
    ip: normalizeIp(rawIp),
    userAgent: String(req.headers?.['user-agent'] || 'unknown').slice(0, 300),
    method: String(req.method || 'GET'),
    path: String(req.originalUrl || req.url || '/').split('?')[0],
  };
}

export function logAuditEvent(db: Database.Database | undefined, entry: AuditEventInput): void {
  if (!db) return;
  try {
    ensureSecuritySchema(db);
    const nowIso = new Date().toISOString();
    const detailsStr =
      typeof entry.details === 'string'
        ? entry.details
        : entry.details
          ? JSON.stringify(entry.details)
          : null;

    db.prepare(`
      INSERT INTO audit_logs (
        timestamp, event_type, severity, username, user_id,
        ip_address, user_agent, method, path, status_code, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      nowIso,
      entry.eventType || 'UNKNOWN_EVENT',
      entry.severity || 'INFO',
      entry.username || null,
      entry.userId ? Number(entry.userId) : null,
      entry.ip || 'unknown',
      entry.userAgent || null,
      entry.method || null,
      entry.path || null,
      entry.statusCode ?? null,
      detailsStr,
    );

    const jsonLine = JSON.stringify({
      timestamp: nowIso,
      eventType: entry.eventType || 'UNKNOWN_EVENT',
      severity: entry.severity || 'INFO',
      username: entry.username || null,
      userId: entry.userId ? Number(entry.userId) : null,
      ip: entry.ip || 'unknown',
      userAgent: entry.userAgent || null,
      method: entry.method || null,
      path: entry.path || null,
      statusCode: entry.statusCode ?? null,
      details: entry.details || null,
    });
    fs.mkdirSync(path.dirname(AUDIT_JSONL_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_JSONL_PATH, `${jsonLine}\n`, 'utf8');
  } catch (err) {
    console.error('[SecurityAudit] Failed to write audit log:', err);
  }
}

export function isIpBruteForceBlocked(db: Database.Database | undefined, ip?: string): boolean {
  if (!db || !ip || ip === '127.0.0.1' || ip === '::1') return false;
  try {
    ensureSecuritySchema(db);
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const row = db
      .prepare(
        `SELECT COUNT(*) as failCount FROM audit_logs
         WHERE ip_address = ?
           AND timestamp >= ?
           AND event_type IN ('AUTH_LOGIN_FAILED', 'AUTH_TOTP_FAILED')`,
      )
      .get(ip, cutoff) as { failCount?: number } | undefined;
    return (row?.failCount || 0) >= 8;
  } catch {
    return false;
  }
}

export function getAuditLogs(
  db: Database.Database,
  options: { limit?: number | string; eventType?: string | null; severity?: string | null } = {},
) {
  ensureSecuritySchema(db);
  const safeLimit = Math.max(1, Math.min(500, Number(options.limit) || 100));
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (options.eventType) {
    clauses.push('event_type = ?');
    params.push(options.eventType);
  }
  if (options.severity) {
    clauses.push('severity = ?');
    params.push(options.severity);
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const logs = db
    .prepare(
      `SELECT id, timestamp, event_type, severity, username, user_id,
              ip_address, user_agent, method, path, status_code, details
       FROM audit_logs
       ${whereSql}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(...params, safeLimit) as Array<Record<string, unknown> & { details?: string | null }>;

  const stats = db
    .prepare(
      `SELECT
          COUNT(*) as totalEvents,
          SUM(CASE WHEN event_type = 'AUTH_LOGIN_SUCCESS' THEN 1 ELSE 0 END) as loginSuccessCount,
          SUM(CASE WHEN event_type IN ('AUTH_LOGIN_FAILED', 'AUTH_TOTP_FAILED', 'AUTH_BRUTEFORCE_BLOCKED') THEN 1 ELSE 0 END) as failedAuthCount,
          SUM(CASE WHEN severity IN ('WARN', 'CRITICAL') THEN 1 ELSE 0 END) as warningCount
       FROM audit_logs`,
    )
    .get() as
    | {
        totalEvents?: number;
        loginSuccessCount?: number;
        failedAuthCount?: number;
        warningCount?: number;
      }
    | undefined;

  return {
    logs: logs.map((row) => {
      let parsedDetails: unknown = row.details;
      try {
        if (typeof row.details === 'string' && row.details.startsWith('{')) {
          parsedDetails = JSON.parse(row.details);
        }
      } catch {
        // Keep raw string when JSON parsing fails
      }
      return { ...row, details: parsedDetails };
    }),
    stats: {
      totalEvents: stats?.totalEvents || 0,
      loginSuccessCount: stats?.loginSuccessCount || 0,
      failedAuthCount: stats?.failedAuthCount || 0,
      warningCount: stats?.warningCount || 0,
      auditFilePath: AUDIT_JSONL_PATH,
    },
  };
}
