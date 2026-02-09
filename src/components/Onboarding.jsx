import React, { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronLeft, Check, GitBranch, User, Mail, LogIn, ExternalLink, Loader2 } from 'lucide-react';
import ClaudeLogo from './ClaudeLogo';
import CursorLogo from './CursorLogo';
import CodexLogo from './CodexLogo';
import LoginModal from './LoginModal';
import { authenticatedFetch } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { IS_PLATFORM } from '../constants/config';

const Onboarding = ({ onComplete }) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [gitName, setGitName] = useState('');
  const [gitEmail, setGitEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [activeLoginProvider, setActiveLoginProvider] = useState(null);
  const [selectedProject] = useState({ name: 'default', fullPath: IS_PLATFORM ? '/workspace' : '' });

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

  const [codexAuthStatus, setCodexAuthStatus] = useState({
    authenticated: false,
    email: null,
    loading: true,
    error: null
  });

  const { user } = useAuth();

  const prevActiveLoginProviderRef = useRef(undefined);

  useEffect(() => {
    loadGitConfig();
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
    }
  };

  useEffect(() => {
    const prevProvider = prevActiveLoginProviderRef.current;
    prevActiveLoginProviderRef.current = activeLoginProvider;

    const isInitialMount = prevProvider === undefined;
    const isModalClosing = prevProvider !== null && activeLoginProvider === null;

    if (isInitialMount || isModalClosing) {
      checkClaudeAuthStatus();
      checkCursorAuthStatus();
      checkCodexAuthStatus();
    }
  }, [activeLoginProvider]);

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

  const checkCodexAuthStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/cli/codex/status');
      if (response.ok) {
        const data = await response.json();
        setCodexAuthStatus({
          authenticated: data.authenticated,
          email: data.email,
          loading: false,
          error: data.error || null
        });
      } else {
        setCodexAuthStatus({
          authenticated: false,
          email: null,
          loading: false,
          error: 'Failed to check authentication status'
        });
      }
    } catch (error) {
      console.error('Error checking Codex auth status:', error);
      setCodexAuthStatus({
        authenticated: false,
        email: null,
        loading: false,
        error: error.message
      });
    }
  };

  const handleClaudeLogin = () => setActiveLoginProvider('claude');
  const handleCursorLogin = () => setActiveLoginProvider('cursor');
  const handleCodexLogin = () => setActiveLoginProvider('codex');

  const handleLoginComplete = (exitCode) => {
    if (exitCode === 0) {
      if (activeLoginProvider === 'claude') {
        checkClaudeAuthStatus();
      } else if (activeLoginProvider === 'cursor') {
        checkCursorAuthStatus();
      } else if (activeLoginProvider === 'codex') {
        checkCodexAuthStatus();
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
      const response = await authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST'
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to complete onboarding');
      }

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
      title: 'Connect Agents',
      description: 'Connect your AI coding assistants',
      icon: LogIn,
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
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-foreground mb-2">Connect Your AI Agents</h2>
              <p className="text-muted-foreground">
                Login to one or more AI coding assistants. All are optional.
              </p>
            </div>

            {/* Agent Cards Grid */}
            <div className="space-y-3">
              {/* Claude */}
              <div className={`border rounded-lg p-4 transition-colors ${
                claudeAuthStatus.authenticated
                  ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                  : 'border-border bg-card'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                      <ClaudeLogo size={20} />
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        Claude Code
                        {claudeAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {claudeAuthStatus.loading ? 'Checking...' :
                         claudeAuthStatus.authenticated ? claudeAuthStatus.email || 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {!claudeAuthStatus.authenticated && !claudeAuthStatus.loading && (
                    <button
                      onClick={handleClaudeLogin}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>

              {/* Cursor */}
              <div className={`border rounded-lg p-4 transition-colors ${
                cursorAuthStatus.authenticated
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800'
                  : 'border-border bg-card'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-full flex items-center justify-center">
                      <CursorLogo size={20} />
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        Cursor
                        {cursorAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {cursorAuthStatus.loading ? 'Checking...' :
                         cursorAuthStatus.authenticated ? cursorAuthStatus.email || 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {!cursorAuthStatus.authenticated && !cursorAuthStatus.loading && (
                    <button
                      onClick={handleCursorLogin}
                      className="bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>

              {/* Codex */}
              <div className={`border rounded-lg p-4 transition-colors ${
                codexAuthStatus.authenticated
                  ? 'bg-gray-100 dark:bg-gray-800/50 border-gray-300 dark:border-gray-600'
                  : 'border-border bg-card'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
                      <CodexLogo className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        OpenAI Codex
                        {codexAuthStatus.authenticated && <Check className="w-4 h-4 text-green-500" />}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {codexAuthStatus.loading ? 'Checking...' :
                         codexAuthStatus.authenticated ? codexAuthStatus.email || 'Connected' : 'Not connected'}
                      </div>
                    </div>
                  </div>
                  {!codexAuthStatus.authenticated && !codexAuthStatus.loading && (
                    <button
                      onClick={handleCodexLogin}
                      className="bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors"
                    >
                      Login
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="text-center text-sm text-muted-foreground pt-2">
              <p>You can configure these later in Settings.</p>
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
        return true; 
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

      {activeLoginProvider && (
        <LoginModal
          isOpen={!!activeLoginProvider}
          onClose={() => setActiveLoginProvider(null)}
          provider={activeLoginProvider}
          project={selectedProject}
          onComplete={handleLoginComplete}
        />
      )}
    </>
  );
};

export default Onboarding;
