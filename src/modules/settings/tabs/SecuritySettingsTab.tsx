import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Shield, KeyRound, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { Button, Input } from '@/shared/ui';

type TotpStatusResponse = {
  username: string;
  totpEnabled: boolean;
  secret: string;
  otpauthUri: string;
  qrCodeDataUrl: string | null;
  backupCodes: string[];
  currentServerTime: string;
};

type AuditLogEntry = {
  id: number;
  timestamp: string;
  event_type: string;
  severity: 'INFO' | 'WARN' | 'CRITICAL' | string;
  username?: string | null;
  ip_address?: string | null;
  details?: Record<string, unknown> | string | null;
};

type AuditLogsResponse = {
  logs: AuditLogEntry[];
  stats: {
    totalEvents: number;
    loginSuccessCount: number;
    failedAuthCount: number;
    warningCount: number;
    auditFilePath: string;
  };
};

export default function SecuritySettingsTab() {
  const { t } = useTranslation('settings');
  const [totpData, setTotpData] = useState<TotpStatusResponse | null>(null);
  const [auditData, setAuditData] = useState<AuditLogsResponse | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);

  const loadSecurityData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [totpRes, auditRes] = await Promise.all([
        api.auth.totpStatus(),
        api.auth.auditLogs(100),
      ]);
      const [totpJson, auditJson] = await Promise.all([
        totpRes.json() as Promise<TotpStatusResponse>,
        auditRes.json() as Promise<AuditLogsResponse>,
      ]);
      setTotpData(totpJson);
      setAuditData(auditJson);
    } catch (error) {
      setStatusMessage({
        text: error instanceof Error ? error.message : 'Failed to load security settings',
        isError: true,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSecurityData();
  }, [loadSecurityData]);

  const handleToggleTotp = async () => {
    if (!totpData) return;
    setStatusMessage(null);
    try {
      const nextEnabled = !totpData.totpEnabled;
      const res = await api.auth.totpToggle(nextEnabled, totpCode.trim());
      const data = (await res.json()) as {
        success?: boolean;
        error?: string | { message?: string };
      };

      if (!res.ok || data.error) {
        const errMsg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message || 'Verification failed';
        setStatusMessage({ text: errMsg, isError: true });
        return;
      }

      setTotpCode('');
      setStatusMessage({
        text: nextEnabled
          ? t('security.totp.enabledSuccess', {
              defaultValue: 'Two-factor authentication (TOTP) enabled.',
            })
          : t('security.totp.disabledSuccess', {
              defaultValue: 'Two-factor authentication (TOTP) disabled.',
            }),
        isError: false,
      });
      await loadSecurityData();
    } catch (error) {
      setStatusMessage({
        text: error instanceof Error ? error.message : 'Failed to update TOTP status',
        isError: true,
      });
    }
  };

  const handleRotateSecret = async () => {
    setStatusMessage(null);
    try {
      await api.auth.totpSetup();
      setTotpCode('');
      setStatusMessage({
        text: t('security.totp.rotatedSuccess', {
          defaultValue: 'New TOTP secret and backup recovery codes generated.',
        }),
        isError: false,
      });
      await loadSecurityData();
    } catch (error) {
      setStatusMessage({
        text: error instanceof Error ? error.message : 'Failed to rotate TOTP secret',
        isError: true,
      });
    }
  };

  if (isLoading && !totpData) {
    return (
      <div className="py-8 text-sm text-muted-foreground">
        {t('security.loading', { defaultValue: 'Loading security settings and audit logs...' })}
      </div>
    );
  }

  const isTotpEnabled = Boolean(totpData?.totpEnabled);
  const stats = auditData?.stats;
  const logs = auditData?.logs ?? [];

  return (
    <div className="space-y-6">
      {/* TOTP 2FA Section */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Shield className="h-4 w-4 text-primary" />
              {t('security.totp.title', {
                defaultValue: 'Two-Factor Authentication (RFC 6238 TOTP)',
              })}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('security.totp.description', {
                defaultValue:
                  'Protect your self-hosted CloudCLI instance with Google Authenticator, Authy, or iOS Passwords.',
              })}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              isTotpEnabled
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            }`}
          >
            {isTotpEnabled
              ? t('security.totp.statusEnabled', { defaultValue: 'Enabled (Enforced on Login)' })
              : t('security.totp.statusDisabled', { defaultValue: 'Disabled (Opt-in)' })}
          </span>
        </div>

        <div className="flex flex-wrap items-start gap-6 border-t border-border pt-4">
          {totpData?.qrCodeDataUrl && (
            <div className="rounded-xl border border-border bg-white p-3 text-center">
              <img
                src={totpData.qrCodeDataUrl}
                alt="TOTP QR Code"
                className="mx-auto h-44 w-44"
              />
              <div className="mt-1.5 text-[11px] font-medium text-slate-600">
                {t('security.totp.scanQr', { defaultValue: 'Scan with Authenticator App' })}
              </div>
            </div>
          )}

          <div className="min-w-[240px] flex-1 space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <KeyRound className="h-3.5 w-3.5" />
                {t('security.totp.secretLabel', { defaultValue: 'Manual Base32 Setup Secret' })}
              </div>
              <div className="mt-1 select-all break-all font-mono text-xs font-semibold text-foreground">
                {totpData?.secret || ''}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-1.5 text-xs text-muted-foreground">
                {t('security.totp.backupCodesLabel', {
                  defaultValue: 'One-Time Backup Recovery Codes',
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(totpData?.backupCodes ?? []).map((code) => (
                  <code
                    key={code}
                    className="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs font-semibold text-foreground"
                  >
                    {code}
                  </code>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {!isTotpEnabled && (
                <Input
                  type="text"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                  placeholder={t('security.totp.codePlaceholder', {
                    defaultValue: 'Enter 6-digit code',
                  })}
                  className="w-48 font-mono text-sm"
                />
              )}
              <Button
                type="button"
                variant={isTotpEnabled ? 'destructive' : 'default'}
                size="sm"
                onClick={() => void handleToggleTotp()}
              >
                {isTotpEnabled
                  ? t('security.totp.disableButton', { defaultValue: 'Disable 2FA' })
                  : t('security.totp.enableButton', { defaultValue: 'Verify & Enable 2FA' })}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRotateSecret()}
              >
                {t('security.totp.rotateButton', { defaultValue: 'Regenerate Secret' })}
              </Button>
            </div>

            {statusMessage && (
              <div
                className={`text-xs font-medium ${
                  statusMessage.isError
                    ? 'text-destructive'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {statusMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Security Audit Logs Section */}
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Activity className="h-4 w-4 text-primary" />
              {t('security.audit.title', { defaultValue: 'Security Audit Logs' })}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('security.audit.description', {
                defaultValue:
                  'Real-time security audit trail for authentication, TOTP verification, and unauthorized API attempts.',
              })}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void loadSecurityData()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t('security.audit.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-[11px] text-muted-foreground">
              {t('security.audit.totalEvents', { defaultValue: 'Total Events' })}
            </div>
            <div className="mt-1 text-lg font-bold text-foreground">
              {stats?.totalEvents ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-[11px] text-muted-foreground">
              {t('security.audit.loginSuccess', { defaultValue: 'Successful Logins' })}
            </div>
            <div className="mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {stats?.loginSuccessCount ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-[11px] text-muted-foreground">
              {t('security.audit.failedAuth', { defaultValue: 'Failed / Blocked Auth' })}
            </div>
            <div className="mt-1 text-lg font-bold text-destructive">
              {stats?.failedAuthCount ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-3">
            <div className="text-[11px] text-muted-foreground">
              {t('security.audit.warnings', { defaultValue: 'Security Warnings' })}
            </div>
            <div className="mt-1 text-lg font-bold text-amber-600 dark:text-amber-400">
              {stats?.warningCount ?? 0}
            </div>
          </div>
        </div>

        <div className="max-h-72 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-border bg-muted/60 text-muted-foreground">
              <tr>
                <th className="p-2.5">Timestamp</th>
                <th className="p-2.5">Severity</th>
                <th className="p-2.5">Event</th>
                <th className="p-2.5">User / IP</th>
                <th className="p-2.5">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((item) => {
                const detailStr =
                  typeof item.details === 'object' && item.details !== null
                    ? JSON.stringify(item.details)
                    : item.details || '-';
                const ts = (item.timestamp || '')
                  .replace('T', ' ')
                  .replace(/\.\d+Z$/, ' UTC');
                return (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap p-2.5 font-mono text-[11px] text-muted-foreground">
                      {ts}
                    </td>
                    <td className="p-2.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          item.severity === 'WARN'
                            ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                            : item.severity === 'CRITICAL'
                              ? 'bg-destructive/15 text-destructive'
                              : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {item.severity}
                      </span>
                    </td>
                    <td className="p-2.5 font-mono font-semibold text-foreground">
                      {item.event_type}
                    </td>
                    <td className="p-2.5 font-mono text-[11px]">
                      {item.username || '-'} ({item.ip_address || '-'})
                    </td>
                    <td className="max-w-[220px] break-all p-2.5 text-muted-foreground">
                      {detailStr}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
