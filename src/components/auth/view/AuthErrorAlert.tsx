import { AlertCircle } from 'lucide-react';
import { resolveApiErrorMessage } from '../utils';

type AuthErrorAlertProps = {
  errorMessage: unknown;
};

export default function AuthErrorAlert({ errorMessage }: AuthErrorAlertProps) {
  if (!errorMessage) {
    return null;
  }

  let messageText = resolveApiErrorMessage(errorMessage, '');

  if (!messageText && typeof errorMessage === 'object') {
    try {
      const json = JSON.stringify(errorMessage);
      if (json && json !== '{}') {
        messageText = json;
      }
    } catch {
      messageText = 'An unexpected error occurred';
    }
  }

  if (!messageText) {
    return null;
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p className="text-sm leading-relaxed">{messageText}</p>
    </div>
  );
}
