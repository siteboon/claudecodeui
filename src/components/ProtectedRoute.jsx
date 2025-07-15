import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import SetupForm from './SetupForm';
import LoginForm from './LoginForm';
import { MessageSquare } from 'lucide-react';

const LoadingScreen = () => (
  <div className="min-h-screen bg-background flex items-center justify-center p-4">
    <div className="text-center">
      <div className="flex justify-center mb-4">
        <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center shadow-sm">
          <MessageSquare className="w-8 h-8 text-primary-foreground" />
        </div>
      </div>
      <h1 className="text-2xl font-bold text-foreground mb-2">Claude Code UI</h1>
      <div className="flex items-center justify-center space-x-2">
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
      </div>
      <p className="text-muted-foreground mt-2">Loading...</p>
    </div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { user, isLoading, needsSetup } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (needsSetup) {
    return <SetupForm />;
  }

  if (!user) {
    return <LoginForm />;
  }

  return children;
};

export default ProtectedRoute;