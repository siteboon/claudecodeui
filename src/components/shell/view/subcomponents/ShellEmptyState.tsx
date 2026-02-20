type ShellEmptyStateProps = {
  title: string;
  description: string;
};

export default function ShellEmptyState({ title, description }: ShellEmptyStateProps) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center text-gray-500 dark:text-gray-400">
        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}
