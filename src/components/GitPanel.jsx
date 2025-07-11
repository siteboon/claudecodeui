import React, { useState, useEffect, useRef } from 'react';
import { GitBranch, GitCommit, Plus, Minus, RefreshCw, Check, X, ChevronDown, ChevronRight, Info, History, FileText, Mic, MicOff, Sparkles } from 'lucide-react';
import { MicButton } from './MicButton.jsx';
import { authenticatedFetch } from '../utils/api';

function GitPanel({ selectedProject, isMobile }) {
  const [gitStatus, setGitStatus] = useState(null);
  const [gitDiff, setGitDiff] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [expandedFiles, setExpandedFiles] = useState(new Set());
  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [isCommitting, setIsCommitting] = useState(false);
  const [currentBranch, setCurrentBranch] = useState('');
  const [branches, setBranches] = useState([]);
  const [wrapText, setWrapText] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const [showNewBranchModal, setShowNewBranchModal] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [isCreatingBranch, setIsCreatingBranch] = useState(false);
  const [activeView, setActiveView] = useState('changes'); // 'changes' or 'history'
  const [recentCommits, setRecentCommits] = useState([]);
  const [expandedCommits, setExpandedCommits] = useState(new Set());
  const [commitDiffs, setCommitDiffs] = useState({});
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const textareaRef = useRef(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (selectedProject) {
      fetchGitStatus();
      fetchBranches();
      if (activeView === 'history') {
        fetchRecentCommits();
      }
    }
  }, [selectedProject, activeView]);

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowBranchDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchGitStatus = async () => {
    if (!selectedProject) return;
    
    console.log('Fetching git status for project:', selectedProject.name, 'path:', selectedProject.path);
    
    setIsLoading(true);
    try {
      const response = await authenticatedFetch(`/api/git/status?project=${encodeURIComponent(selectedProject.name)}`);
      const data = await response.json();
      
      console.log('Git status response:', data);
      
      if (data.error) {
        console.error('Git status error:', data.error);
        setGitStatus({ error: data.error, details: data.details });
      } else {
        setGitStatus(data);
        setCurrentBranch(data.branch || 'main');
        
        // Auto-select all changed files
        const allFiles = new Set([
          ...(data.modified || []),
          ...(data.added || []),
          ...(data.deleted || []),
          ...(data.untracked || [])
        ]);
        setSelectedFiles(allFiles);
        
        // Fetch diffs for changed files
        for (const file of data.modified || []) {
          fetchFileDiff(file);
        }
        for (const file of data.added || []) {
          fetchFileDiff(file);
        }
      }
    } catch (error) {
      console.error('Error fetching git status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchBranches = async () => {
    try {
      const response = await authenticatedFetch(`/api/git/branches?project=${encodeURIComponent(selectedProject.name)}`);
      const data = await response.json();
      
      if (!data.error && data.branches) {
        setBranches(data.branches);
      }
    } catch (error) {
      console.error('Error fetching branches:', error);
    }
  };

  const switchBranch = async (branchName) => {
    try {
      const response = await authenticatedFetch('/api/git/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedProject.name,
          branch: branchName
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setCurrentBranch(branchName);
        setShowBranchDropdown(false);
        fetchGitStatus(); // Refresh status after branch switch
      } else {
        console.error('Failed to switch branch:', data.error);
      }
    } catch (error) {
      console.error('Error switching branch:', error);
    }
  };

  const createBranch = async () => {
    if (!newBranchName.trim()) return;
    
    setIsCreatingBranch(true);
    try {
      const response = await authenticatedFetch('/api/git/create-branch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedProject.name,
          branch: newBranchName.trim()
        })
      });
      
      const data = await response.json();
      if (data.success) {
        setCurrentBranch(newBranchName.trim());
        setShowNewBranchModal(false);
        setShowBranchDropdown(false);
        setNewBranchName('');
        fetchBranches(); // Refresh branch list
        fetchGitStatus(); // Refresh status
      } else {
        console.error('Failed to create branch:', data.error);
      }
    } catch (error) {
      console.error('Error creating branch:', error);
    } finally {
      setIsCreatingBranch(false);
    }
  };

  const fetchFileDiff = async (filePath) => {
    try {
      const response = await authenticatedFetch(`/api/git/diff?project=${encodeURIComponent(selectedProject.name)}&file=${encodeURIComponent(filePath)}`);
      const data = await response.json();
      
      if (!data.error && data.diff) {
        setGitDiff(prev => ({
          ...prev,
          [filePath]: data.diff
        }));
      }
    } catch (error) {
      console.error('Error fetching file diff:', error);
    }
  };

  const fetchRecentCommits = async () => {
    try {
      const response = await authenticatedFetch(`/api/git/commits?project=${encodeURIComponent(selectedProject.name)}&limit=10`);
      const data = await response.json();
      
      if (!data.error && data.commits) {
        setRecentCommits(data.commits);
      }
    } catch (error) {
      console.error('Error fetching commits:', error);
    }
  };

  const fetchCommitDiff = async (commitHash) => {
    try {
      const response = await authenticatedFetch(`/api/git/commit-diff?project=${encodeURIComponent(selectedProject.name)}&commit=${commitHash}`);
      const data = await response.json();
      
      if (!data.error && data.diff) {
        setCommitDiffs(prev => ({
          ...prev,
          [commitHash]: data.diff
        }));
      }
    } catch (error) {
      console.error('Error fetching commit diff:', error);
    }
  };

  const generateCommitMessage = async () => {
    setIsGeneratingMessage(true);
    try {
      const response = await authenticatedFetch('/api/git/generate-commit-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedProject.name,
          files: Array.from(selectedFiles)
        })
      });
      
      const data = await response.json();
      if (data.message) {
        setCommitMessage(data.message);
      } else {
        console.error('Failed to generate commit message:', data.error);
      }
    } catch (error) {
      console.error('Error generating commit message:', error);
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  const toggleFileExpanded = (filePath) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  const toggleCommitExpanded = (commitHash) => {
    setExpandedCommits(prev => {
      const newSet = new Set(prev);
      if (newSet.has(commitHash)) {
        newSet.delete(commitHash);
      } else {
        newSet.add(commitHash);
        // Fetch diff for this commit if not already fetched
        if (!commitDiffs[commitHash]) {
          fetchCommitDiff(commitHash);
        }
      }
      return newSet;
    });
  };

  const toggleFileSelected = (filePath) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  const handleCommit = async () => {
    if (!commitMessage.trim() || selectedFiles.size === 0) return;
    
    setIsCommitting(true);
    try {
      const response = await authenticatedFetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: selectedProject.name,
          message: commitMessage,
          files: Array.from(selectedFiles)
        })
      });
      
      const data = await response.json();
      if (data.success) {
        // Reset state after successful commit
        setCommitMessage('');
        setSelectedFiles(new Set());
        fetchGitStatus();
      } else {
        console.error('Commit failed:', data.error);
      }
    } catch (error) {
      console.error('Error committing changes:', error);
    } finally {
      setIsCommitting(false);
    }
  };

  const renderDiffLine = (line, index) => {
    const isAddition = line.startsWith('+') && !line.startsWith('+++');
    const isDeletion = line.startsWith('-') && !line.startsWith('---');
    const isHeader = line.startsWith('@@');
    
    return (
      <div
        key={index}
        className={`font-mono text-xs ${
          isMobile && wrapText ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'
        } ${
          isAddition ? 'bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300' :
          isDeletion ? 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300' :
          isHeader ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300' :
          'text-gray-600 dark:text-gray-400'
        }`}
      >
        {line}
      </div>
    );
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case 'M': return 'Modified';
      case 'A': return 'Added';
      case 'D': return 'Deleted';
      case 'U': return 'Untracked';
      default: return status;
    }
  };

  const renderCommitItem = (commit) => {
    const isExpanded = expandedCommits.has(commit.hash);
    const diff = commitDiffs[commit.hash];
    
    return (
      <div key={commit.hash} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
        <div 
          className="flex items-start p-3 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
          onClick={() => toggleCommitExpanded(commit.hash)}
        >
          <div className="mr-2 mt-1 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {commit.message}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {commit.author} • {commit.date}
                </p>
              </div>
              <span className="text-xs font-mono text-gray-400 dark:text-gray-500 flex-shrink-0">
                {commit.hash.substring(0, 7)}
              </span>
            </div>
          </div>
        </div>
        {isExpanded && diff && (
          <div className="bg-gray-50 dark:bg-gray-900">
            <div className="max-h-96 overflow-y-auto p-2">
              <div className="text-xs font-mono text-gray-600 dark:text-gray-400 mb-2">
                {commit.stats}
              </div>
              {diff.split('\n').map((line, index) => renderDiffLine(line, index))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderFileItem = (filePath, status) => {
    const isExpanded = expandedFiles.has(filePath);
    const isSelected = selectedFiles.has(filePath);
    const diff = gitDiff[filePath];
    
    return (
      <div key={filePath} className="border-b border-gray-200 dark:border-gray-700 last:border-0">
        <div className="flex items-center px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleFileSelected(filePath)}
            onClick={(e) => e.stopPropagation()}
            className="mr-2 rounded border-gray-300 dark:border-gray-600 text-blue-600 dark:text-blue-500 focus:ring-blue-500 dark:focus:ring-blue-400 dark:bg-gray-800 dark:checked:bg-blue-600"
          />
          <div 
            className="flex items-center flex-1 cursor-pointer"
            onClick={() => toggleFileExpanded(filePath)}
          >
            <div className="mr-2 p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </div>
            <span className="flex-1 text-sm truncate">{filePath}</span>
            <span 
              className={`inline-flex items-center justify-center w-5 h-5 rounded text-xs font-bold border ${
                status === 'M' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800' :
                status === 'A' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-green-200 dark:border-green-800' :
                status === 'D' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-red-200 dark:border-red-800' :
                'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-600'
              }`}
              title={getStatusLabel(status)}
            >
              {status}
            </span>
          </div>
        </div>
        {isExpanded && diff && (
          <div className="bg-gray-50 dark:bg-gray-900">
            {isMobile && (
              <div className="flex justify-end p-2 border-b border-gray-200 dark:border-gray-700">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setWrapText(!wrapText);
                  }}
                  className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                  title={wrapText ? "Switch to horizontal scroll" : "Switch to text wrap"}
                >
                  {wrapText ? '↔️ Scroll' : '↩️ Wrap'}
                </button>
              </div>
            )}
            <div className="max-h-96 overflow-y-auto p-2">
              {diff.split('\n').map((line, index) => renderDiffLine(line, index))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (!selectedProject) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
        <p>Select a project to view source control</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setShowBranchDropdown(!showBranchDropdown)}
            className="flex items-center space-x-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
          >
            <GitBranch className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            <span className="text-sm font-medium">{currentBranch}</span>
            <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${showBranchDropdown ? 'rotate-180' : ''}`} />
          </button>
          
          {/* Branch Dropdown */}
          {showBranchDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50">
              <div className="py-1 max-h-64 overflow-y-auto">
                {branches.map(branch => (
                  <button
                    key={branch}
                    onClick={() => switchBranch(branch)}
                    className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      branch === currentBranch ? 'bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {branch === currentBranch && <Check className="w-3 h-3 text-green-600 dark:text-green-400" />}
                      <span className={branch === currentBranch ? 'font-medium' : ''}>{branch}</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-200 dark:border-gray-700 py-1">
                <button
                  onClick={() => {
                    setShowNewBranchModal(true);
                    setShowBranchDropdown(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center space-x-2"
                >
                  <Plus className="w-3 h-3" />
                  <span>Create new branch</span>
                </button>
              </div>
            </div>
          )}
        </div>
        
        <button
          onClick={() => {
            fetchGitStatus();
            fetchBranches();
          }}
          disabled={isLoading}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Git Repository Not Found Message */}
      {gitStatus?.error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 px-6 py-12">
          <GitBranch className="w-20 h-20 mb-6 opacity-30" />
          <h3 className="text-xl font-medium mb-3 text-center">{gitStatus.error}</h3>
          {gitStatus.details && (
            <p className="text-sm text-center leading-relaxed mb-6 max-w-md">{gitStatus.details}</p>
          )}
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 max-w-md">
            <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
              <strong>Tip:</strong> Run <code className="bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded font-mono text-xs">git init</code> in your project directory to initialize git source control.
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Tab Navigation - Only show when git is available */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            <button
              onClick={() => setActiveView('changes')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeView === 'changes'
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <FileText className="w-4 h-4" />
                <span>Changes</span>
              </div>
            </button>
            <button
              onClick={() => setActiveView('history')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                activeView === 'history'
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <History className="w-4 h-4" />
                <span>History</span>
              </div>
            </button>
          </div>

          {/* Changes View */}
          {activeView === 'changes' && (
            <>
              {/* Commit Message Input */}
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder="Message (Ctrl+Enter to commit)"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 resize-none pr-20"
                    rows="3"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        handleCommit();
                      }
                    }}
                  />
                  <div className="absolute right-2 top-2 flex gap-1">
                    <button
                      onClick={generateCommitMessage}
                      disabled={selectedFiles.size === 0 || isGeneratingMessage}
                      className="p-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Generate commit message"
                    >
                      {isGeneratingMessage ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                    </button>
                    <div style={{ display: 'none' }}>
                      <MicButton
                        onTranscript={(transcript) => setCommitMessage(transcript)}
                        mode="default"
                        className="p-1.5"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500">
                    {selectedFiles.size} file{selectedFiles.size !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={handleCommit}
                    disabled={!commitMessage.trim() || selectedFiles.size === 0 || isCommitting}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1"
                  >
                    <Check className="w-3 h-3" />
                    <span>{isCommitting ? 'Committing...' : 'Commit'}</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* File Selection Controls - Only show in changes view and when git is working */}
          {activeView === 'changes' && gitStatus && !gitStatus.error && (
            <div className="px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {selectedFiles.size} of {(gitStatus?.modified?.length || 0) + (gitStatus?.added?.length || 0) + (gitStatus?.deleted?.length || 0) + (gitStatus?.untracked?.length || 0)} files selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const allFiles = new Set([
                      ...(gitStatus?.modified || []),
                      ...(gitStatus?.added || []),
                      ...(gitStatus?.deleted || []),
                      ...(gitStatus?.untracked || [])
                    ]);
                    setSelectedFiles(allFiles);
                  }}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  Select All
                </button>
                <span className="text-gray-300 dark:text-gray-600">|</span>
                <button
                  onClick={() => setSelectedFiles(new Set())}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                >
                  Deselect All
                </button>
              </div>
            </div>
          )}

          {/* Status Legend Toggle */}
          {!gitStatus?.error && (
            <div className="border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setShowLegend(!showLegend)}
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 text-xs text-gray-600 dark:text-gray-400 flex items-center justify-center gap-1"
              >
                <Info className="w-3 h-3" />
                <span>File Status Guide</span>
                {showLegend ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
              
              {showLegend && (
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 text-xs">
                  <div className={`${isMobile ? 'grid grid-cols-2 gap-3 justify-items-center' : 'flex justify-center gap-6'}`}>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 rounded border border-yellow-200 dark:border-yellow-800 font-bold text-xs">
                        M
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 italic">Modified</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded border border-green-200 dark:border-green-800 font-bold text-xs">
                        A
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 italic">Added</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded border border-red-200 dark:border-red-800 font-bold text-xs">
                        D
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 italic">Deleted</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-5 h-5 bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded border border-gray-300 dark:border-gray-600 font-bold text-xs">
                        U
                      </span>
                      <span className="text-gray-600 dark:text-gray-400 italic">Untracked</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* File List - Changes View - Only show when git is available */}
      {activeView === 'changes' && !gitStatus?.error && (
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-20' : ''}`}>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : !gitStatus || (!gitStatus.modified?.length && !gitStatus.added?.length && !gitStatus.deleted?.length && !gitStatus.untracked?.length) ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 dark:text-gray-400">
              <GitCommit className="w-12 h-12 mb-2 opacity-50" />
              <p className="text-sm">No changes detected</p>
            </div>
          ) : (
            <div className={isMobile ? 'pb-4' : ''}>
              {gitStatus.modified?.map(file => renderFileItem(file, 'M'))}
              {gitStatus.added?.map(file => renderFileItem(file, 'A'))}
              {gitStatus.deleted?.map(file => renderFileItem(file, 'D'))}
              {gitStatus.untracked?.map(file => renderFileItem(file, 'U'))}
            </div>
          )}
        </div>
      )}

      {/* History View - Only show when git is available */}
      {activeView === 'history' && !gitStatus?.error && (
        <div className={`flex-1 overflow-y-auto ${isMobile ? 'pb-20' : ''}`}>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <RefreshCw className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : recentCommits.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 dark:text-gray-400">
              <History className="w-12 h-12 mb-2 opacity-50" />
              <p className="text-sm">No commits found</p>
            </div>
          ) : (
            <div className={isMobile ? 'pb-4' : ''}>
              {recentCommits.map(commit => renderCommitItem(commit))}
            </div>
          )}
        </div>
      )}

      {/* New Branch Modal */}
      {showNewBranchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowNewBranchModal(false)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <h3 className="text-lg font-semibold mb-4">Create New Branch</h3>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Branch Name
                </label>
                <input
                  type="text"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isCreatingBranch) {
                      createBranch();
                    }
                  }}
                  placeholder="feature/new-feature"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                This will create a new branch from the current branch ({currentBranch})
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowNewBranchModal(false);
                    setNewBranchName('');
                  }}
                  className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                >
                  Cancel
                </button>
                <button
                  onClick={createBranch}
                  disabled={!newBranchName.trim() || isCreatingBranch}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
                >
                  {isCreatingBranch ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" />
                      <span>Create Branch</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GitPanel;