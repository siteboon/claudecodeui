import React, { useEffect, useState } from 'react';
import { Github } from 'lucide-react';
import { api } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const RequireGithubAuth = ({ children }) => {
  const [isGithubAuthenticated, setIsGithubAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const { token } = useAuth();

  useEffect(() => {
    const checkGithubAuth = async () => {
      if (!token) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await api.auth.githubStatus();
        if (response.ok) {
          const data = await response.json();
          setIsGithubAuthenticated(data.isGithubAuthenticated);
        }
      } catch (error) {
        console.error('Failed to check GitHub auth status:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkGithubAuth();
  }, [token]);

  const handleGithubLogin = () => {
    // Store current URL to return after auth
    const returnUrl = window.location.pathname + window.location.search;
    window.location.href = `/api/auth/github?returnUrl=${encodeURIComponent(returnUrl)}`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Checking authentication...</div>
      </div>
    );
  }

  if (!isGithubAuthenticated) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="bg-card rounded-lg shadow-lg border border-border p-8 max-w-md w-full mx-4">
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <div className="w-16 h-16 bg-gray-800 rounded-lg flex items-center justify-center">
                <Github className="w-8 h-8 text-white" />
              </div>
            </div>
            
            <h2 className="text-xl font-bold text-foreground">GitHub Authentication Required</h2>
            
            <p className="text-muted-foreground">
              This feature requires GitHub authentication. Please sign in with your GitHub account to continue.
            </p>
            
            <button
              onClick={handleGithubLogin}
              className="w-full bg-gray-800 hover:bg-gray-900 text-white font-medium py-2 px-4 rounded-md transition-colors duration-200 flex items-center justify-center gap-2"
            >
              <Github className="w-5 h-5" />
              Sign in with GitHub
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
};

export default RequireGithubAuth;