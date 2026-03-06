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
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90">
        <div className="text-white">{loadingLabel}</div>
      </div>
    );
  }

  if (mode === 'connect') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
        <div className="w-full max-w-sm text-center">
          <button
            onClick={onConnect}
            className="flex w-full items-center justify-center space-x-2 rounded-lg bg-green-600 px-6 py-3 text-base font-medium text-white transition-colors hover:bg-green-700 sm:w-auto"
            title={connectTitle}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>{connectLabel}</span>
          </button>
          <p className="mt-3 px-2 text-sm text-gray-400">{description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center space-x-3 text-yellow-400">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent"></div>
          <span className="text-base font-medium">{connectingLabel}</span>
        </div>
        <p className="mt-3 px-2 text-sm text-gray-400">{description}</p>
      </div>
    </div>
  );
}
