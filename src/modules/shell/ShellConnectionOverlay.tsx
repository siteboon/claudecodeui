import { Loader2, RotateCcw } from 'lucide-react';

type ShellConnectionOverlayProps = {
  mode: 'loading' | 'connect' | 'connecting';
  description: string;
  loadingLabel: string;
  connectLabel: string;
  connectTitle: string;
  connectingLabel: string;
  onConnect: () => void;
};

export default function ShellConnectionOverlay({
  mode,
  description,
  loadingLabel,
  connectLabel,
  connectTitle,
  connectingLabel,
  onConnect,
}: ShellConnectionOverlayProps) {
  if (mode === 'loading') {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-950/90">
        <div className="inline-flex items-center gap-2 text-sm font-medium text-gray-100">
          <Loader2 className="h-4 w-4 animate-spin text-blue-300" aria-hidden="true" />
          <span>{loadingLabel}</span>
        </div>
      </div>
    );
  }

  if (mode === 'connect') {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-950/90 p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
          <button
            type="button"
            onClick={onConnect}
            className="pointer-events-auto inline-flex min-h-12 w-full max-w-xs cursor-pointer items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-950/30 transition-colors hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-gray-950 active:bg-emerald-700"
            title={connectTitle}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            <span className="min-w-0 truncate">{connectLabel}</span>
          </button>
          <p className="max-w-md break-words px-2 text-sm leading-6 text-gray-300">{description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-950/90 p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-3 text-center">
        <div className="flex items-center justify-center gap-3 text-yellow-300">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="text-base font-medium">{connectingLabel}</span>
        </div>
        <p className="max-w-md break-words px-2 text-sm leading-6 text-gray-300">{description}</p>
      </div>
    </div>
  );
}
