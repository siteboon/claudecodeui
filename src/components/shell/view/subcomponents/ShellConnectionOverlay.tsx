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
        <div className="text-center max-w-sm w-full">
          <button
            onClick={onConnect}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center justify-center space-x-2 text-base font-medium w-full sm:w-auto"
            title={connectTitle}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span>{connectLabel}</span>
          </button>
          <p className="text-gray-400 text-sm mt-3 px-2">{description}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-90 p-4">
      <div className="text-center max-w-sm w-full">
        <div className="flex items-center justify-center space-x-3 text-yellow-400">
          <div className="w-6 h-6 animate-spin rounded-full border-2 border-yellow-400 border-t-transparent"></div>
          <span className="text-base font-medium">{connectingLabel}</span>
        </div>
        <p className="text-gray-400 text-sm mt-3 px-2">{description}</p>
      </div>
    </div>
  );
}
