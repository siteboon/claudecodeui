import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ClaudeLogo from './ClaudeLogo';
import { Github } from 'lucide-react';
import { api } from '../utils/api';

const SetupForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [authStatus, setAuthStatus] = useState({});
  
  useEffect(() => {
    // Get auth status including GitHub configuration
    const checkAuthStatus = async () => {
      try {
        const response = await api.auth.status();
        const data = await response.json();
        setAuthStatus(data);
      } catch (err) {
        console.error('Failed to check auth status:', err);
      }
    };
    checkAuthStatus();
  }, []);

  const handleGithubLogin = () => {
    setIsLoading(true);
    // Redirect to GitHub OAuth endpoint
    window.location.href = `${window.location.origin}/api/auth/github`;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg border border-border p-8 space-y-6">
          {/* Logo and Title */}
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <ClaudeLogo size={64} />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Welcome to Claude Code UI</h1>
            <p className="text-muted-foreground mt-2">
              {authStatus.githubConfigured ? 'Sign in with GitHub to get started' : 'GitHub authentication not configured'}
            </p>
          </div>

          {/* GitHub Login Button */}
          {authStatus.githubConfigured ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={handleGithubLogin}
                disabled={isLoading}
                className="w-full bg-gray-800 hover:bg-gray-900 disabled:bg-gray-600 text-white font-medium py-2 px-4 rounded-md transition-colors duration-200 flex items-center justify-center gap-2"
              >
                <Github className="w-5 h-5" />
                {isLoading ? 'Redirecting...' : 'Sign in with GitHub'}
              </button>
              
              {authStatus.githubAllowedUsers && authStatus.githubAllowedUsers.length > 0 && (
                <div className="text-xs text-center text-muted-foreground">
                  Allowed users: {authStatus.githubAllowedUsers.join(', ')}
                </div>
              )}
              
              {error && (
                <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
                  <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800 rounded-md">
              <p className="text-sm text-yellow-700 dark:text-yellow-400 text-center">
                GitHub authentication is not configured. Please check your environment variables.
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default SetupForm;