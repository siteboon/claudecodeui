import { MessageSquare } from 'lucide-react';

const loadingDotAnimationDelays = ['0s', '0.1s', '0.2s'];

export default function AuthLoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center">
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-primary shadow-sm">
            <MessageSquare className="h-8 w-8 text-primary-foreground" />
          </div>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-foreground">CloudCLI</h1>

        <div className="flex items-center justify-center space-x-2">
          {loadingDotAnimationDelays.map((delay) => (
            <div
              key={delay}
              className="h-2 w-2 animate-bounce rounded-full bg-blue-500"
              style={{ animationDelay: delay }}
            />
          ))}
        </div>

        <p className="mt-2 text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
