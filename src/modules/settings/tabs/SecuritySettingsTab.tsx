import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { Button, Input } from '@/shared/ui';

type TotpStatusResponse = {
  username: string;
  totpEnabled: boolean;
  hasPendingSetup?: boolean;
  secret: string | null;
  otpauthUri: string | null;
  qrCodeDataUrl: string | null;
  backupCodes: string[];
};

/**
 * Settings tab for managing opt-in RFC 6238 TOTP Two-Factor Authentication (2FA).
 */
export default function SecuritySettingsTab() {
  const { t } = useTranslation('settings');
  const [totpData, setTotpData] = useState<TotpStatusResponse | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);

  const loadTotpStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.auth.totpStatus();
      if (!response.ok) {
        setStatusMessage({
          text: 'Failed to load TOTP 2FA status.',
          isError: true,
        });
        return;
      }
      const json = (await response.json()) as TotpStatusResponse;
      setTotpData(json);
    } catch (error) {
      setStatusMessage({
        text: error instanceof Error ? error.message : 'Failed to load TOTP 2FA status',
        isError: true,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTotpStatus();
  }, [loadTotpStatus]);

  const handleToggleTotp = async (nextEnabled: boolean) => {
    if (!totpData) return;
    setStatusMessage(null);
    try {
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
      await loadTotpStatus();
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
      const res = await api.auth.totpSetup(totpCode.trim() || undefined);
      const data = (await res.json()) as {
        success?: boolean;
        error?: string | { message?: string };
      };

      if (!res.ok || data.error) {
        const errMsg =
          typeof data.error === 'string'
            ? data.error
            : data.error?.message || 'Failed to rotate TOTP secret';
        setStatusMessage({ text: errMsg, isError: true });
        return;
      }

      setTotpCode('');
      setStatusMessage({
        text: t('security.totp.rotatedSuccess', {
          defaultValue:
            'New pending TOTP secret and backup codes generated. Verify a 6-digit code to activate.',
        }),
        isError: false,
      });
      await loadTotpStatus();
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
        {t('security.loading', { defaultValue: 'Loading 2FA security settings...' })}
      </div>
    );
  }

  const isTotpEnabled = Boolean(totpData?.totpEnabled);
  const hasPendingSetup = Boolean(totpData?.hasPendingSetup || totpData?.secret);

  return (
    <div className="space-y-6">
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
          {hasPendingSetup && totpData?.qrCodeDataUrl && (
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
            {hasPendingSetup && totpData?.secret ? (
              <>
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <KeyRound className="h-3.5 w-3.5" />
                    {t('security.totp.secretLabel', {
                      defaultValue: 'Manual Base32 Setup Secret',
                    })}
                  </div>
                  <div className="mt-1 select-all break-all font-mono text-xs font-semibold text-foreground">
                    {totpData.secret}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <div className="mb-1.5 text-xs text-muted-foreground">
                    {t('security.totp.backupCodesLabel', {
                      defaultValue: 'One-Time Backup Recovery Codes',
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(totpData.backupCodes ?? []).map((code) => (
                      <code
                        key={code}
                        className="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs font-semibold text-foreground"
                      >
                        {code}
                      </code>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
                {t('security.totp.activeProtectedNote', {
                  defaultValue:
                    'Two-factor authentication is active. For security, the active secret and backup codes are hidden. Enter a current 6-digit TOTP or backup code below to disable 2FA or generate a replacement secret.',
                })}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Input
                type="text"
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                placeholder={t('security.totp.codePlaceholder', {
                  defaultValue: 'Enter 6-digit code or backup code',
                })}
                className="w-60 font-mono text-sm"
              />

              {hasPendingSetup && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => void handleToggleTotp(true)}
                >
                  {t('security.totp.enableButton', { defaultValue: 'Verify & Enable 2FA' })}
                </Button>
              )}

              {isTotpEnabled && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void handleToggleTotp(false)}
                >
                  {t('security.totp.disableButton', { defaultValue: 'Disable 2FA' })}
                </Button>
              )}

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
    </div>
  );
}
