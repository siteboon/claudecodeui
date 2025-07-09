import React, { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import ClaudeLogo from './ClaudeLogo';

function AuthForm() {
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Reload page to apply authenticated state
        window.location.reload();
      } else {
        setError(data.error || 'Invalid token');
      }
    } catch (err) {
      setError('Failed to verify token. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <ClaudeLogo size={64} />
          </div>
          <h1 className="text-2xl font-bold mb-2">Claude Code UI</h1>
          <p className="text-muted-foreground">Enter your authentication token to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input
              type="password"
              placeholder="Enter authentication token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              disabled={loading}
              autoFocus
              className="w-full"
            />
          </div>

          {error && (
            <div className="text-sm text-destructive text-center">
              {error}
            </div>
          )}

          <Button
            type="submit"
            disabled={!token || loading}
            className="w-full"
          >
            {loading ? 'Verifying...' : 'Authenticate'}
          </Button>
        </form>

        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>Token is configured in your .env file</p>
          <p className="mt-1">Generate a secure token with:</p>
          <code className="block mt-2 p-2 bg-muted rounded text-xs">
            openssl rand -hex 32
          </code>
        </div>
      </div>
    </div>
  );
}

export default AuthForm;