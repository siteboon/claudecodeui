import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext({
  user: null,
  login: () => {},
  logout: () => {},
  isLoading: true,
  error: null
});

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Check authentication status on mount
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Check authentication status with Authentik
      const response = await fetch('/auth/status', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.isAuthenticated && data.user) {
          setUser(data.user);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error('Auth status check failed:', error);
      setError('Failed to check authentication status');
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async () => {
    try {
      setError(null);
      
      // Get Authentik authorization URL
      const response = await fetch('/auth/login', {
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Redirect to Authentik login page
        window.location.href = data.authorizationUrl;
        return { success: true };
      } else {
        const data = await response.json();
        setError(data.error || 'Login initialization failed');
        return { success: false, error: data.error || 'Login initialization failed' };
      }
    } catch (error) {
      console.error('Login error:', error);
      const errorMessage = 'Failed to initialize login. Please try again.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };


  const logout = async () => {
    try {
      const response = await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Clear user state
        setUser(null);
        
        // If Authentik provides a logout URL, redirect to it
        if (data.logoutUrl) {
          window.location.href = data.logoutUrl;
        } else {
          // Otherwise just reload the page
          window.location.reload();
        }
      } else {
        // Even if logout fails on server, clear local state
        setUser(null);
        window.location.reload();
      }
    } catch (error) {
      console.error('Logout error:', error);
      // Clear local state regardless
      setUser(null);
      window.location.reload();
    }
  };

  const value = {
    user,
    login,
    logout,
    isLoading,
    error
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};