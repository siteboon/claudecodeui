import { WifiOff } from 'lucide-react';

export default function ConnectionBanner({ isConnected }: { isConnected: boolean }) {
  if (isConnected) return null;

  return (
    <div className="flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
      <WifiOff className="h-4 w-4" />
      <span>Connection lost. Attempting to reconnect...</span>
    </div>
  );
}
