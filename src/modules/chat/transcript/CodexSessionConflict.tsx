import { useTranslation } from 'react-i18next';

/** Used by MessageComponent for a failed web-chat resume of an occupied Codex thread. */
export function CodexSessionConflict({ details }: { details: string }) {
  const { t } = useTranslation('chat');
  return (
    <div role="alert" className="rounded-md border border-amber-500/40 p-3 text-sm">
      <p className="font-medium">{t('codexSessionConflict.title', { defaultValue: 'This session is still open in another Codex process' })}</p>
      <p className="mt-2">{t('codexSessionConflict.explanation', {
        defaultValue: 'A completed reply does not close an interactive Codex session. Another terminal or client can still hold its write lock, so this chat message could not start.',
      })}</p>
      <p className="mt-2">{t('codexSessionConflict.recovery', {
        defaultValue: 'If you opened this session in CloudCLI Terminal, reconnect to that terminal and choose End terminal, then resend here. For an external Codex client, exit that session there first. Ending a terminal interrupts any work still running in it.',
      })}</p>
      <details className="mt-3">
        <summary className="cursor-pointer">{t('codexSessionConflict.details', { defaultValue: 'Technical details' })}</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{details}</pre>
      </details>
    </div>
  );
}
