import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MessageSquare, LogIn, Shield } from 'lucide-react';

const LoginForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { login } = useAuth();

  const handleLogin = async () => {
    setError('');
    setIsLoading(true);
    
    const result = await login();
    
    if (!result.success) {
      setError(result.error);
      setIsLoading(false);
    }
    // If successful, the page will redirect to Authentik
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg border border-border p-8 space-y-6">
          {/* Logo and Title */}
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center shadow-sm">
                <MessageSquare className="w-8 h-8 text-primary-foreground" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-foreground">Welcome to Claude Code UI</h1>
            <p className="text-muted-foreground mt-2">
              Sign in with your Authentik account
            </p>
          </div>

          {/* Authentik Login */}
          <div className="space-y-4">
            <div className="p-4 bg-muted/50 rounded-lg border border-border">
              <div className="flex items-center space-x-2 mb-2">
                <Shield className="w-5 h-5 text-blue-600" />
                <span className="font-medium text-foreground">Secure Authentication</span>
              </div>
              <p className="text-sm text-muted-foreground">
                You will be redirected to Authentik to securely sign in with your organization account.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium py-3 px-4 rounded-md transition-colors duration-200 flex items-center justify-center space-x-2"
            >
              <LogIn className="w-5 h-5" />
              <span>{isLoading ? 'Redirecting to Authentik...' : 'Sign In with Authentik'}</span>
            </button>
          </div>

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              By signing in, you agree to authenticate through your organization's Authentik instance
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;