import { AlertCircle } from 'lucide-react';

type AuthErrorAlertProps = {
  errorMessage: string;
};

export default function AuthErrorAlert({ errorMessage }: AuthErrorAlertProps) {
  if (!errorMessage) {
    return null;
  }

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p className="text-sm leading-relaxed">{errorMessage}</p>
    </div>
  );
}
