import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../utils/api';

const AuthContext = createContext({
  user: null,
  token: null,
  logout: () => {},
  isLoading: true,
  needsSetup: false,
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
  const [token, setToken] = useState(localStorage.getItem('auth-token'));
  const [isLoading, setIsLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [error, setError] = useState(null);

  // Check authentication status on mount
  useEffect(() => {
    // Check for token in URL (OAuth callback)
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    const urlError = urlParams.get('error');
    
    if (urlError) {
      // Handle OAuth error
      setError(urlError === 'github_auth_failed' ? 'GitHub authentication failed. Please try again.' : 'Authentication failed.');
      window.history.replaceState({}, document.title, window.location.pathname);
      setIsLoading(false);
      return;
    }
    
    if (urlToken) {
      // Store token and clean URL
      localStorage.setItem('auth-token', urlToken);
      setToken(urlToken);
      
      // Remove token from URL
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Pass token directly to avoid state timing issues
      checkAuthStatus(urlToken);
      
      // Force reload after a short delay to ensure proper state update
      setTimeout(() => {
        window.location.reload();
      }, 100);
    } else {
      checkAuthStatus();
    }
  }, []);

  const checkAuthStatus = async (providedToken = null) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Check if system needs setup
      const statusResponse = await api.auth.status();
      const statusData = await statusResponse.json();
      
      if (statusData.needsSetup) {
        setNeedsSetup(true);
        setIsLoading(false);
        return;
      }
      
      // Use provided token or state token
      const authToken = providedToken || token;
      
      // If we have a token, verify it
      if (authToken) {
        try {
          const userResponse = await api.auth.user();
          
          if (userResponse.ok) {
            const userData = await userResponse.json();
            setUser(userData.user);
            setNeedsSetup(false);
          } else {
            // Token is invalid
            localStorage.removeItem('auth-token');
            setToken(null);
            setUser(null);
          }
        } catch (error) {
          console.error('Token verification failed:', error);
          localStorage.removeItem('auth-token');
          setToken(null);
          setUser(null);
        }
      }
    } catch (error) {
      console.error('Auth status check failed:', error);
      setError('Failed to check authentication status');
    } finally {
      setIsLoading(false);
    }
  };


  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth-token');
    
    // Optional: Call logout endpoint for logging
    if (token) {
      api.auth.logout().catch(error => {
        console.error('Logout endpoint error:', error);
      });
    }
  };

  const value = {
    user,
    token,
    logout,
    isLoading,
    needsSetup,
    error
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};