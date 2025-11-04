import React, { useState, useEffect } from 'react';
import { X, FolderPlus, GitBranch, Key, ChevronRight, ChevronLeft, Check, Loader2, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { api } from '../utils/api';

const ProjectCreationWizard = ({ onClose, onProjectCreated }) => {
  // Wizard state
  const [step, setStep] = useState(1); // 1: Choose type, 2: Configure, 3: Confirm
  const [workspaceType, setWorkspaceType] = useState(null); // 'existing' or 'new'

  // Form state
  const [workspacePath, setWorkspacePath] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [selectedGithubToken, setSelectedGithubToken] = useState('');
  const [tokenMode, setTokenMode] = useState('stored'); // 'stored' | 'new' | 'none'
  const [newGithubToken, setNewGithubToken] = useState('');

  // UI state
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);
  const [availableTokens, setAvailableTokens] = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [pathSuggestions, setPathSuggestions] = useState([]);
  const [showPathDropdown, setShowPathDropdown] = useState(false);

  // Load available GitHub tokens when needed
  useEffect(() => {
    if (step === 2 && workspaceType === 'new' && githubUrl) {
      loadGithubTokens();
    }
  }, [step, workspaceType, githubUrl]);

  // Load path suggestions
  useEffect(() => {
    if (workspacePath.length > 2) {
      loadPathSuggestions(workspacePath);
    } else {
      setPathSuggestions([]);
      setShowPathDropdown(false);
    }
  }, [workspacePath]);

  const loadGithubTokens = async () => {
    try {
      setLoadingTokens(true);
      const response = await api.get('/settings/credentials?type=github_token');
      const data = await response.json();

      const activeTokens = (data.credentials || []).filter(t => t.is_active);
      setAvailableTokens(activeTokens);

      // Auto-select first token if available
      if (activeTokens.length > 0 && !selectedGithubToken) {
        setSelectedGithubToken(activeTokens[0].id.toString());
      }
    } catch (error) {
      console.error('Error loading GitHub tokens:', error);
    } finally {
      setLoadingTokens(false);
    }
  };

  const loadPathSuggestions = async (inputPath) => {
    try {
      // Extract the directory to browse (parent of input)
      const lastSlash = inputPath.lastIndexOf('/');
      const dirPath = lastSlash > 0 ? inputPath.substring(0, lastSlash) : '~';

      const response = await api.browseFilesystem(dirPath);
      const data = await response.json();

      if (data.suggestions) {
        // Filter suggestions based on the input
        const filtered = data.suggestions.filter(s =>
          s.path.toLowerCase().startsWith(inputPath.toLowerCase())
        );
        setPathSuggestions(filtered.slice(0, 5));
        setShowPathDropdown(filtered.length > 0);
      }
    } catch (error) {
      console.error('Error loading path suggestions:', error);
    }
  };

  const handleNext = () => {
    setError(null);

    if (step === 1) {
      if (!workspaceType) {
        setError('Please select whether you have an existing workspace or want to create a new one');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!workspacePath.trim()) {
        setError('Please provide a workspace path');
        return;
      }

      // No validation for GitHub token - it's optional (only needed for private repos)
      setStep(3);
    }
  };

  const handleBack = () => {
    setError(null);
    setStep(step - 1);
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);

    try {
      const payload = {
        workspaceType,
        path: workspacePath.trim(),
      };

      // Add GitHub info if creating new workspace with GitHub URL
      if (workspaceType === 'new' && githubUrl) {
        payload.githubUrl = githubUrl.trim();

        if (tokenMode === 'stored' && selectedGithubToken) {
          payload.githubTokenId = parseInt(selectedGithubToken);
        } else if (tokenMode === 'new' && newGithubToken) {
          payload.newGithubToken = newGithubToken.trim();
        }
      }

      const response = await api.createWorkspace(payload);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create workspace');
      }

      // Success!
      if (onProjectCreated) {
        onProjectCreated(data.project);
      }

      onClose();
    } catch (error) {
      console.error('Error creating workspace:', error);
      setError(error.message || 'Failed to create workspace');
    } finally {
      setIsCreating(false);
    }
  };

  const selectPathSuggestion = (suggestion) => {
    setWorkspacePath(suggestion.path);
    setShowPathDropdown(false);
  };

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-0 sm:p-4">
      <div className="bg-white dark:bg-gray-800 rounded-none sm:rounded-lg shadow-xl w-full h-full sm:h-auto sm:max-w-2xl border-0 sm:border border-gray-200 dark:border-gray-700 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/50 rounded-lg flex items-center justify-center">
              <FolderPlus className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Create New Project
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            disabled={isCreating}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress Indicator */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center justify-between">
            {[1, 2, 3].map((s) => (
              <React.Fragment key={s}>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-medium text-sm ${
                      s < step
                        ? 'bg-green-500 text-white'
                        : s === step
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-500'
                    }`}
                  >
                    {s < step ? <Check className="w-4 h-4" /> : s}
                  </div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:inline">
                    {s === 1 ? 'Type' : s === 2 ? 'Configure' : 'Confirm'}
                  </span>
                </div>
                {s < 3 && (
                  <div
                    className={`flex-1 h-1 mx-2 rounded ${
                      s < step ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 min-h-[300px]">
          {/* Error Display */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
              </div>
            </div>
          )}

          {/* Step 1: Choose workspace type */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  Do you already have a workspace, or would you like to create a new one?
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Existing Workspace */}
                  <button
                    onClick={() => setWorkspaceType('existing')}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      workspaceType === 'existing'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-green-100 dark:bg-green-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FolderPlus className="w-5 h-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                          Existing Workspace
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          I already have a workspace on my server and just need to add it to the project list
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* New Workspace */}
                  <button
                    onClick={() => setWorkspaceType('new')}
                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                      workspaceType === 'new'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <GitBranch className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="flex-1">
                        <h5 className="font-semibold text-gray-900 dark:text-white mb-1">
                          New Workspace
                        </h5>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          Create a new workspace, optionally clone from a GitHub repository
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Configure workspace */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Workspace Path */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {workspaceType === 'existing' ? 'Workspace Path' : 'Where should the workspace be created?'}
                </label>
                <div className="relative">
                  <Input
                    type="text"
                    value={workspacePath}
                    onChange={(e) => setWorkspacePath(e.target.value)}
                    placeholder={workspaceType === 'existing' ? '/path/to/existing/workspace' : '/path/to/new/workspace'}
                    className="w-full"
                  />
                  {showPathDropdown && pathSuggestions.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                      {pathSuggestions.map((suggestion, index) => (
                        <button
                          key={index}
                          onClick={() => selectPathSuggestion(suggestion)}
                          className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 text-sm"
                        >
                          <div className="font-medium text-gray-900 dark:text-white">{suggestion.name}</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">{suggestion.path}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {workspaceType === 'existing'
                    ? 'Full path to your existing workspace directory'
                    : 'Full path where the new workspace will be created'}
                </p>
              </div>

              {/* GitHub URL (only for new workspace) */}
              {workspaceType === 'new' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      GitHub URL (Optional)
                    </label>
                    <Input
                      type="text"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/username/repository"
                      className="w-full"
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Leave empty to create an empty workspace, or provide a GitHub URL to clone
                    </p>
                  </div>

                  {/* GitHub Token (only if GitHub URL is provided) */}
                  {githubUrl && (
                    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                      <div className="flex items-start gap-3 mb-4">
                        <Key className="w-5 h-5 text-gray-600 dark:text-gray-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <h5 className="font-medium text-gray-900 dark:text-white mb-1">
                            GitHub Authentication (Optional)
                          </h5>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            Only required for private repositories. Public repos can be cloned without authentication.
                          </p>
                        </div>
                      </div>

                      {loadingTokens ? (
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading stored tokens...
                        </div>
                      ) : availableTokens.length > 0 ? (
                        <>
                          {/* Token Selection Tabs */}
                          <div className="grid grid-cols-3 gap-2 mb-4">
                            <button
                              onClick={() => setTokenMode('stored')}
                              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                                tokenMode === 'stored'
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              Stored Token
                            </button>
                            <button
                              onClick={() => setTokenMode('new')}
                              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                                tokenMode === 'new'
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              New Token
                            </button>
                            <button
                              onClick={() => {
                                setTokenMode('none');
                                setSelectedGithubToken('');
                                setNewGithubToken('');
                              }}
                              className={`px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                                tokenMode === 'none'
                                  ? 'bg-green-500 text-white'
                                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                              }`}
                            >
                              None (Public)
                            </button>
                          </div>

                          {tokenMode === 'stored' ? (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Select Token
                              </label>
                              <select
                                value={selectedGithubToken}
                                onChange={(e) => setSelectedGithubToken(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm"
                              >
                                <option value="">-- Select a token --</option>
                                {availableTokens.map((token) => (
                                  <option key={token.id} value={token.id}>
                                    {token.credential_name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : tokenMode === 'new' ? (
                            <div>
                              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                GitHub Token
                              </label>
                              <Input
                                type="password"
                                value={newGithubToken}
                                onChange={(e) => setNewGithubToken(e.target.value)}
                                placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                                className="w-full"
                              />
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                This token will be used only for this operation
                              </p>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="space-y-4">
                          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-200 dark:border-blue-800">
                            <p className="text-sm text-blue-800 dark:text-blue-200">
                              💡 <strong>Public repositories</strong> don't require authentication. You can skip providing a token if cloning a public repo.
                            </p>
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              GitHub Token (Optional for Public Repos)
                            </label>
                            <Input
                              type="password"
                              value={newGithubToken}
                              onChange={(e) => setNewGithubToken(e.target.value)}
                              placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (leave empty for public repos)"
                              className="w-full"
                            />
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              No stored tokens available. You can add tokens in Settings → API Keys for easier reuse.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  Review Your Configuration
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Workspace Type:</span>
                    <span className="font-medium text-gray-900 dark:text-white">
                      {workspaceType === 'existing' ? 'Existing Workspace' : 'New Workspace'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Path:</span>
                    <span className="font-mono text-xs text-gray-900 dark:text-white break-all">
                      {workspacePath}
                    </span>
                  </div>
                  {workspaceType === 'new' && githubUrl && (
                    <>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Clone From:</span>
                        <span className="font-mono text-xs text-gray-900 dark:text-white break-all">
                          {githubUrl}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600 dark:text-gray-400">Authentication:</span>
                        <span className="text-xs text-gray-900 dark:text-white">
                          {tokenMode === 'stored' && selectedGithubToken
                            ? `Using stored token: ${availableTokens.find(t => t.id.toString() === selectedGithubToken)?.credential_name || 'Unknown'}`
                            : tokenMode === 'new' && newGithubToken
                            ? 'Using provided token'
                            : 'No authentication'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  {workspaceType === 'existing'
                    ? 'The workspace will be added to your project list and will be available for Claude/Cursor sessions.'
                    : githubUrl
                    ? 'A new workspace will be created and the repository will be cloned from GitHub.'
                    : 'An empty workspace directory will be created at the specified path.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <Button
            variant="outline"
            onClick={step === 1 ? onClose : handleBack}
            disabled={isCreating}
          >
            {step === 1 ? (
              'Cancel'
            ) : (
              <>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </>
            )}
          </Button>

          <Button
            onClick={step === 3 ? handleCreate : handleNext}
            disabled={isCreating || (step === 1 && !workspaceType)}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : step === 3 ? (
              <>
                <Check className="w-4 h-4 mr-1" />
                Create Project
              </>
            ) : (
              <>
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProjectCreationWizard;
