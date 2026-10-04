import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { KeyRound, Loader2, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import AuthErrorAlert from '@/modules/auth/AuthErrorAlert';
import AuthInputField from '@/modules/auth/AuthInputField';
import { api } from '@/shared/api';

type TotpEnrollmentPayload = {
  username: string;
  totpEnabled: boolean;
  secret: string | null;
  otpauthUri: string | null;
  qrCodeDataUrl: string | null;
  backupCodes: string[];
};

type TotpEnrollmentStepProps = {
  onComplete: () => Promise<void> | void;
  onSkip: () => Promise<void> | void;
};

/**
 * Inline TOTP 2FA enrollment card rendered during initial account registration or sign-in
 * when the user opts to link an authenticator app alongside their username and password.
 */
export default function TotpEnrollmentStep({ onComplete, onSkip }: TotpEnrollmentStepProps) {
  const { t } = useTranslation('auth');
  const [setupData, setSetupData] = useState<TotpEnrollmentPayload | null>(null);
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);

  const loadPendingTotp = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const response = await api.auth.totpStatus();
      if (!response.ok) {
        setErrorMessage('Failed to initialize TOTP 2FA enrollment.');
        return;
      }
      const data = (await response.json()) as TotpEnrollmentPayload;
      setSetupData(data);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to initialize TOTP 2FA enrollment.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPendingTotp();
  }, [loadPendingTotp]);

  const handleVerify = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setErrorMessage('');

      if (!code.trim()) {
        setErrorMessage(
          t('totp.errors.codeRequired', {
            defaultValue: 'Please enter the 6-digit code from your authenticator app.',
          }),
        );
        return;
      }

      setIsVerifying(true);
      try {
        const response = await api.auth.totpToggle(true, code.trim());
        const payload = (await response.json()) as {
          success?: boolean;
          error?: string | { message?: string };
        };
        if (!response.ok || payload.error) {
          const message =
            typeof payload.error === 'string'
              ? payload.error
              : payload.error?.message || 'Invalid 6-digit TOTP verification code.';
          setErrorMessage(message);
          setIsVerifying(false);
          return;
        }
        await onComplete();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to verify 6-digit TOTP code.',
        );
        setIsVerifying(false);
      }
    },
    [code, onComplete, t],
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span>
          {t('totp.loading', { defaultValue: 'Preparing TOTP 2FA enrollment...' })}
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleVerify} className="space-y-4">
      {setupData?.qrCodeDataUrl && (
        <div className="mx-auto w-fit rounded-xl border border-border bg-white p-3 text-center shadow-sm">
          <img
            src={setupData.qrCodeDataUrl}
            alt="TOTP QR Code"
            className="mx-auto h-40 w-40"
          />
          <p className="mt-1.5 text-[11px] font-medium text-slate-600">
            {t('totp.scanQr', {
              defaultValue: 'Scan with Google Authenticator, Authy, or iOS Passwords',
            })}
          </p>
        </div>
      )}

      {setupData?.secret && (
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5" />
            <span>
              {t('totp.secretLabel', { defaultValue: 'Manual Base32 Setup Key' })}
            </span>
          </div>
          <div className="mt-1 select-all break-all font-mono text-xs font-semibold text-foreground">
            {setupData.secret}
          </div>
        </div>
      )}

      {setupData?.backupCodes && setupData.backupCodes.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <div className="mb-1.5 text-xs text-muted-foreground">
            {t('totp.backupCodesLabel', {
              defaultValue: 'One-Time Recovery Backup Codes (save these safely)',
            })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {setupData.backupCodes.map((backup) => (
              <code
                key={backup}
                className="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs font-semibold text-foreground"
              >
                {backup}
              </code>
            ))}
          </div>
        </div>
      )}

      <AuthInputField
        id="totpEnrollCode"
        label={t('totp.verifyCodeLabel', { defaultValue: '6-Digit Verification Code' })}
        value={code}
        onChange={setCode}
        placeholder={t('totp.verifyCodePlaceholder', {
          defaultValue: 'Enter 6-digit code from app',
        })}
        isDisabled={isVerifying}
        autoComplete="one-time-code"
        icon={Shield}
      />

      <AuthErrorAlert errorMessage={errorMessage} />

      <div className="flex flex-col gap-2">
        <button
          type="submit"
          disabled={isVerifying}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-primary/30 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-card active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isVerifying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('totp.verifying', { defaultValue: 'Verifying...' })}
            </>
          ) : (
            t('totp.enableAndContinue', { defaultValue: 'Verify & Enable 2FA' })
          )}
        </button>

        <button
          type="button"
          disabled={isVerifying}
          onClick={() => void onSkip()}
          className="w-full rounded-xl border border-border bg-background px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {t('totp.skipForNow', { defaultValue: 'Skip 2FA setup for now' })}
        </button>
      </div>
    </form>
  );
}
