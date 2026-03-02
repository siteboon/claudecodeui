import { GitBranch, Mail, User } from 'lucide-react';

type GitConfigurationStepProps = {
  gitName: string;
  gitEmail: string;
  isSubmitting: boolean;
  onGitNameChange: (value: string) => void;
  onGitEmailChange: (value: string) => void;
};

export default function GitConfigurationStep({
  gitName,
  gitEmail,
  isSubmitting,
  onGitNameChange,
  onGitEmailChange,
}: GitConfigurationStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <GitBranch className="w-8 h-8 text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Git Configuration</h2>
        <p className="text-muted-foreground">
          Configure your git identity to ensure proper attribution for commits.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="gitName" className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
            <User className="w-4 h-4" />
            Git Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="gitName"
            value={gitName}
            onChange={(event) => onGitNameChange(event.target.value)}
            className="w-full px-4 py-3 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="John Doe"
            required
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-muted-foreground">Saved as `git config --global user.name`.</p>
        </div>

        <div>
          <label htmlFor="gitEmail" className="flex items-center gap-2 text-sm font-medium text-foreground mb-2">
            <Mail className="w-4 h-4" />
            Git Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            id="gitEmail"
            value={gitEmail}
            onChange={(event) => onGitEmailChange(event.target.value)}
            className="w-full px-4 py-3 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="john@example.com"
            required
            disabled={isSubmitting}
          />
          <p className="mt-1 text-xs text-muted-foreground">Saved as `git config --global user.email`.</p>
        </div>
      </div>
    </div>
  );
}
