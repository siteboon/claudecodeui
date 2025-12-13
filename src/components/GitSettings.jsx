import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { GitBranch, Check } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';

function GitSettings() {
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [gitConfigLoading, setGitConfigLoading] = useState(false);
  const [gitConfigSaving, setGitConfigSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    loadGitConfig();
  }, []);

  const loadGitConfig = async () => {
    try {
      setGitConfigLoading(true);
      const response = await authenticatedFetch('/api/user/git-config');
      if (response.ok) {
        const data = await response.json();
        setGitName(data.gitName || '');
        setGitEmail(data.gitEmail || '');
      }
    } catch (error) {
      console.error('Error loading git config:', error);
    } finally {
      setGitConfigLoading(false);
    }
  };

  const saveGitConfig = async () => {
    try {
      setGitConfigSaving(true);
      const response = await authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gitName, gitEmail })
      });

      if (response.ok) {
        setSaveStatus('success');
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        const data = await response.json();
        setSaveStatus('error');
        console.error('Failed to save git config:', data.error);
      }
    } catch (error) {
      console.error('Error saving git config:', error);
      setSaveStatus('error');
    } finally {
      setGitConfigSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="h-5 w-5" />
          <h3 className="text-lg font-semibold">Git Configuration</h3>
        </div>

        <p className="text-sm text-muted-foreground mb-4">
          Configure your git identity for commits. These settings will be applied globally via <code className="bg-muted px-2 py-0.5 rounded text-xs">git config --global</code>
        </p>

        <div className="p-4 border rounded-lg bg-card space-y-3">
          <div>
            <label htmlFor="settings-git-name" className="block text-sm font-medium text-foreground mb-2">
              Git Name
            </label>
            <Input
              id="settings-git-name"
              type="text"
              value={gitName}
              onChange={(e) => setGitName(e.target.value)}
              placeholder="John Doe"
              disabled={gitConfigLoading}
              className="w-full"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Your name for git commits
            </p>
          </div>

          <div>
            <label htmlFor="settings-git-email" className="block text-sm font-medium text-foreground mb-2">
              Git Email
            </label>
            <Input
              id="settings-git-email"
              type="email"
              value={gitEmail}
              onChange={(e) => setGitEmail(e.target.value)}
              placeholder="john@example.com"
              disabled={gitConfigLoading}
              className="w-full"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Your email for git commits
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={saveGitConfig}
              disabled={gitConfigSaving || !gitName || !gitEmail}
            >
              {gitConfigSaving ? 'Saving...' : 'Save Configuration'}
            </Button>

            {saveStatus === 'success' && (
              <div className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
                <Check className="w-4 h-4" />
                Saved successfully
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GitSettings;
