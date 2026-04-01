type AuthErrorAlertProps = {
  errorMessage: string;
};

export default function AuthErrorAlert({ errorMessage }: AuthErrorAlertProps) {
  if (!errorMessage) {
    return null;
  }

  return (
    <div className="rounded-md border border-red-300 bg-red-100 p-3 dark:border-red-800 dark:bg-red-900/20">
      <p className="text-sm text-red-700 dark:text-red-400">{errorMessage}</p>
    </div>
  );
}
