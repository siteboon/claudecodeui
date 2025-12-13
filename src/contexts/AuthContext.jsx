import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../utils/api';

const AuthContext = createContext({
  user: null,
  token: null,
  login: () => {},
  register: () => {},
  logout: () => {},
  isLoading: true,
  needsSetup: false,
  hasCompletedOnboarding: true,
  refreshOnboardingStatus: () => {},
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
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (import.meta.env.VITE_IS_PLATFORM === 'true') {
      setUser({ username: 'platform-user' });
      setNeedsSetup(false);
      checkOnboardingStatus();
      setIsLoading(false);
      return;
    }

    checkAuthStatus();
  }, []);

  const checkOnboardingStatus = async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (response.ok) {
        const data = await response.json();
        setHasCompletedOnboarding(data.hasCompletedOnboarding);
      }
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      setHasCompletedOnboarding(true);
    }
  };

  const refreshOnboardingStatus = async () => {
    await checkOnboardingStatus();
  };

  const checkAuthStatus = async () => {
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

      // If we have a token, verify it
      if (token) {
        try {
          const userResponse = await api.auth.user();

          if (userResponse.ok) {
            const userData = await userResponse.json();
            setUser(userData.user);
            setNeedsSetup(false);
            await checkOnboardingStatus();
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
      console.error('[AuthContext] Auth status check failed:', error);
      setError('Failed to check authentication status');
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (username, password) => {
    try {
      setError(null);
      const response = await api.auth.login(username, password);

      const data = await response.json();

      if (response.ok) {
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem('auth-token', data.token);
        return { success: true };
      } else {
        setError(data.error || 'Login failed');
        return { success: false, error: data.error || 'Login failed' };
      }
    } catch (error) {
      console.error('Login error:', error);
      const errorMessage = 'Network error. Please try again.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    }
  };

  const register = async (username, password) => {
    try {
      setError(null);
      const response = await api.auth.register(username, password);

      const data = await response.json();

      if (response.ok) {
        setToken(data.token);
        setUser(data.user);
        setNeedsSetup(false);
        localStorage.setItem('auth-token', data.token);
        return { success: true };
      } else {
        setError(data.error || 'Registration failed');
        return { success: false, error: data.error || 'Registration failed' };
      }
    } catch (error) {
      console.error('Registration error:', error);
      const errorMessage = 'Network error. Please try again.';
      setError(errorMessage);
      return { success: false, error: errorMessage };
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
    login,
    register,
    logout,
    isLoading,
    needsSetup,
    hasCompletedOnboarding,
    refreshOnboardingStatus,
    error
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};