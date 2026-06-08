import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { PendingSudoRequest } from '../../hooks/useSudoPasswordPrompt';

type SudoPasswordModalProps = {
  request: PendingSudoRequest;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

/**
 * Password prompt shown when a chat agent runs a sudo command that needs a
 * password. The value is sent straight back over the WebSocket and never kept.
 */
export default function SudoPasswordModal({ request, onSubmit, onCancel }: SudoPasswordModalProps) {
  const { t } = useTranslation('chat');
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, []);

  // Reset when a new prompt arrives (e.g. after a wrong password retry).
  useEffect(() => {
    setPassword('');
  }, [request.requestId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(password);
        }}
        className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-800 p-4 shadow-xl"
      >
        <div className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-100">
          <span aria-hidden>🔒</span>
          <span>{t('shell.sudo.title')}</span>
        </div>
        <p className="mb-3 truncate font-mono text-xs text-gray-400" title={request.prompt}>
          {request.prompt}
        </p>
        <input
          ref={inputRef}
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder={t('shell.sudo.placeholder')}
          className="mb-3 w-full rounded border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded bg-gray-700 px-3 py-1.5 text-xs font-medium text-gray-200 transition-colors hover:bg-gray-600"
          >
            {t('shell.sudo.cancel')}
          </button>
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
          >
            {t('shell.sudo.submit')}
          </button>
        </div>
      </form>
    </div>
  );
}
