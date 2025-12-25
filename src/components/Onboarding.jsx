import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Check, GitBranch, User, Mail, LogIn, ExternalLink, Loader2 } from 'lucide-react';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';
import LoginModal from './LoginModal';
import { authenticatedFetch } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

const Onboarding = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  // CLI authentication states
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginProvider, setLoginProvider] = useState('');
  const [selectedProject, setSelectedProject] = useState({ name: 'default', fullPath: '' });

  const [claudeAuthStatus, setClaudeAuthStatus] = useState({
    authenticated: false,
    email: null,
    loading: true,
    error: null
  });

  const [cursorAuthStatus, setCursorAuthStatus] = useState({
    authenticated: false,
    email: null,
    loading: true,
    error: null
  });

  const { user } = useAuth();

  // Load existing git config on mount
  useEffect(() => {
    loadGitConfig();
  }, []);

  // Check authentication status on mount and when modal closes
  useEffect(() => {
    checkClaudeAuthStatus();
    checkCursorAuthStatus();
  }, []);

  const loadGitConfig = async () => {
    try {
      const response = await authenticatedFetch('/api/user/git-config');
      if (response.ok) {
        const data = await response.json();
        if (data.gitName) setGitName(data.gitName);
        if (data.gitEmail) setGitEmail(data.gitEmail);
      }
    } catch (error) {
      console.error('Error loading git config:', error);
      // Silently fail - user can still enter config manually
    }
  };

  // Auto-check authentication status periodically when on CLI steps
  useEffect(() => {
    if (currentStep === 1 || currentStep === 2) {
      const interval = setInterval(() => {
        if (currentStep === 1) {
          checkClaudeAuthStatus();
        } else if (currentStep === 2) {
          checkCursorAuthStatus();
        }
      }, 3000); // Check every 3 seconds

      return () => clearInterval(interval);
    }
  }, [currentStep]);

  const checkClaudeAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/claude/status');
      if (response.ok) {
        const data = await response.json();
        setClaudeAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          loading: false,
          error: data.error || null
        });
      } else {
        setClaudeAuthStatus({
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status'
        });
      }
    } catch (error) {
      console.error('Error checking Claude auth status:', error);
      setClaudeAuthStatus({
        authenticated: false,
        email: null,
        loading: false,
        error: error.message
      });
    }
  };

  const checkCursorAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/cursor/status');
      if (response.ok) {
        const data = await response.json();
        setCursorAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          loading: false,
          error: data.error || null
        });
      } else {
        setCursorAuthStatus({
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status'
        });
      }
    } catch (error) {
      console.error('Error checking Cursor auth status:', error);
      setCursorAuthStatus({
        authenticated: false,
        email: null,
        loading: false,
        error: error.message
      });
    }
  };

  const handleClaudeLogin = () => {
    setLoginProvider('claude');
    setShowLoginModal(true);
  };

  const handleCursorLogin = () => {
    setLoginProvider('cursor');
    setShowLoginModal(true);
  };

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      if (loginProvider === 'claude') {
        checkClaudeAuthStatus();
      } else if (loginProvider === 'cursor') {
        checkCursorAuthStatus();
      }
    }
  };

  const handleNextStep = async () => {
    setError('');

    // Step 0: Git config validation and submission
    if (currentStep === 0) {
      if (!gitName.trim() || !gitEmail.trim()) {
        setError('Both git name and email are required');
        return;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(gitEmail)) {
        setError('Please enter a valid email address');
        return;
      }

      setIsSubmitting(true);
      try {
        // Save git config to backend (which will also apply git config --global)
        const response = await authenticatedFetch('/api/user/git-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gitName, gitEmail })
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to save git configuration');
        }

        setCurrentStep(currentStep + 1);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Other steps: just move forward
    setCurrentStep(currentStep + 1);
  };

  const handlePrevStep = () => {
    setError('');
    setCurrentStep(currentStep - 1);
  };

  const handleFinish = async () => {
    setIsSubmitting(true);
    setError('');

    try {
      // Mark onboarding as complete
      const response = await authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

      // Call the onComplete callback
      if (onComplete) {
        onComplete();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const steps = [
    {
      title: 'Git Configuration',
      description: 'Set up your git identity for commits',
      icon: GitBranch,
      required: true
    },
    {
      title: 'Claude Code CLI',
      description: 'Connect your Claude Code account',
      icon: () => <ClaudeLogo size={24} />,
      required: false
    },
    {
      title: 'Cursor CLI',
      description: 'Connect your Cursor account',
      icon: () => <CursorLogo size={24} />,
      required: false
    }
  ];

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <GitBranch className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Git Configuration</h2>
              <p className="text-muted-foreground">
                Configure your git identity to ensure proper attribution for your commits
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
                  onChange={(e) => setGitName(e.target.value)}
                  className="w-full px-4 py-3 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="John Doe"
                  required
                  disabled={isSubmitting}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  This will be used as: git config --global user.name
                </p>
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
                  onChange={(e) => setGitEmail(e.target.value)}
                  className="w-full px-4 py-3 border border-border rounded-lg bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="john@example.com"
                  required
                  disabled={isSubmitting}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  This will be used as: git config --global user.email
                </p>
              </div>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <ClaudeLogo size={32} />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Claude Code CLI</h2>
              <p className="text-muted-foreground">
                Connect your Claude account to enable AI-powered coding features
              </p>
            </div>

            {/* Auth Status Card */}
            <div className="border border-border rounded-lg p-6 bg-card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    claudeAuthStatus.loading ? 'bg-gray-400 animate-pulse' :
                    claudeAuthStatus.authenticated ? 'bg-green-500' : 'bg-gray-300'
                  }`} />
                  <span className="font-medium text-foreground">
                    {claudeAuthStatus.loading ? 'Checking...' :
                     claudeAuthStatus.authenticated ? 'Connected' : 'Not Connected'}
                  </span>
                </div>
                {claudeAuthStatus.authenticated && (
                  <Check className="w-5 h-5 text-green-500" />
                )}
              </div>

              {claudeAuthStatus.authenticated && claudeAuthStatus.email && (
                <p className="text-sm text-muted-foreground mb-4">
                  Signed in as: <span className="text-foreground font-medium">{claudeAuthStatus.email}</span>
                </p>
              )}

              {!claudeAuthStatus.authenticated && (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    Click the button below to authenticate with Claude Code CLI. A terminal will open with authentication instructions.
                  </p>
                  <button
                    onClick={handleClaudeLogin}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-5 h-5" />
                    Login to Claude Code
                  </button>
                  <p className="text-xs text-muted-foreground mt-3 text-center">
                    Or manually run: <code className="bg-muted px-2 py-1 rounded">claude auth login</code>
                  </p>
                </>
              )}

              {claudeAuthStatus.error && !claudeAuthStatus.authenticated && (
                <div className="mt-4 p-3 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800 rounded-lg">
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">{claudeAuthStatus.error}</p>
                </div>
              )}
            </div>

            <div className="text-center text-sm text-muted-foreground">
              <p>This step is optional. You can skip and configure it later in Settings.</p>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                <CursorLogo size={32} />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Cursor CLI</h2>
              <p className="text-muted-foreground">
                Connect your Cursor account to enable AI-powered features
              </p>
            </div>

            {/* Auth Status Card */}
            <div className="border border-border rounded-lg p-6 bg-card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${
                    cursorAuthStatus.loading ? 'bg-gray-400 animate-pulse' :
                    cursorAuthStatus.authenticated ? 'bg-green-500' : 'bg-gray-300'
                  }`} />
                  <span className="font-medium text-foreground">
                    {cursorAuthStatus.loading ? 'Checking...' :
                     cursorAuthStatus.authenticated ? 'Connected' : 'Not Connected'}
                  </span>
                </div>
                {cursorAuthStatus.authenticated && (
                  <Check className="w-5 h-5 text-green-500" />
                )}
              </div>

              {cursorAuthStatus.authenticated && cursorAuthStatus.email && (
                <p className="text-sm text-muted-foreground mb-4">
                  Signed in as: <span className="text-foreground font-medium">{cursorAuthStatus.email}</span>
                </p>
              )}

              {!cursorAuthStatus.authenticated && (
                <>
                  <p className="text-sm text-muted-foreground mb-4">
                    Click the button below to authenticate with Cursor CLI. A terminal will open with authentication instructions.
                  </p>
                  <button
                    onClick={handleCursorLogin}
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
                  >
                    <LogIn className="w-5 h-5" />
                    Login to Cursor
                  </button>
                  <p className="text-xs text-muted-foreground mt-3 text-center">
                    Or manually run: <code className="bg-muted px-2 py-1 rounded">cursor auth login</code>
                  </p>
                </>
              )}

              {cursorAuthStatus.error && !cursorAuthStatus.authenticated && (
                <div className="mt-4 p-3 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800 rounded-lg">
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">{cursorAuthStatus.error}</p>
                </div>
              )}
            </div>

            <div className="text-center text-sm text-muted-foreground">
              <p>This step is optional. You can skip and configure it later in Settings.</p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const isStepValid = () => {
    switch (currentStep) {
      case 0:
        return gitName.trim() && gitEmail.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gitEmail);
      case 1:
      case 2:
        return true; // CLI steps are optional
      default:
        return false;
    }
  };

  return (
    <>
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          {/* Progress Steps */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {steps.map((step, index) => (
                <React.Fragment key={index}>
                  <div className="flex flex-col items-center flex-1">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 transition-colors duration-200 ${
                      index < currentStep ? 'bg-green-500 border-green-500 text-white' :
                      index === currentStep ? 'bg-blue-600 border-blue-600 text-white' :
                      'bg-background border-border text-muted-foreground'
                    }`}>
                      {index < currentStep ? (
                        <Check className="w-6 h-6" />
                      ) : typeof step.icon === 'function' ? (
                        <step.icon />
                      ) : (
                        <step.icon className="w-6 h-6" />
                      )}
                    </div>
                    <div className="mt-2 text-center">
                      <p className={`text-sm font-medium ${
                        index === currentStep ? 'text-foreground' : 'text-muted-foreground'
                      }`}>
                        {step.title}
                      </p>
                      {step.required && (
                        <span className="text-xs text-red-500">Required</span>
                      )}
                    </div>
                  </div>
                  {index < steps.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-2 transition-colors duration-200 ${
                      index < currentStep ? 'bg-green-500' : 'bg-border'
                    }`} />
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-card rounded-lg shadow-lg border border-border p-8">
            {renderStepContent()}

            {/* Error Message */}
            {error && (
              <div className="mt-6 p-4 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-lg">
                <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
              <button
                onClick={handlePrevStep}
                disabled={currentStep === 0 || isSubmitting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>

              <div className="flex items-center gap-3">
                {currentStep < steps.length - 1 ? (
                  <button
                    onClick={handleNextStep}
                    disabled={!isStepValid() || isSubmitting}
                    className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        Next
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={handleFinish}
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors duration-200"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Completing...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Complete Setup
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Login Modal */}
      {showLoginModal && (
        <LoginModal
          key={loginProvider}
          isOpen={showLoginModal}
          onClose={() => setShowLoginModal(false)}
          provider={loginProvider}
          project={selectedProject}
          onLoginComplete={handleLoginComplete}
        />
      )}
    </>
  );
};

export default Onboarding;
