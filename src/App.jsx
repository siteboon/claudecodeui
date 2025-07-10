/*
 * App.jsx - Main Application Component with Session Protection System
 * 
 * SESSION PROTECTION SYSTEM OVERVIEW:
 * ===================================
 * 
 * Problem: Automatic project updates from WebSocket would refresh the sidebar and clear chat messages
 * during active conversations, creating a poor user experience.
 * 
 * Solution: Track "active sessions" and pause project updates during conversations.
 * 
 * How it works:
 * 1. When user sends message → session marked as "active" 
 * 2. Project updates are skipped while session is active
 * 3. When conversation completes/aborts → session marked as "inactive"
 * 4. Project updates resume normally
 * 
 * Handles both existing sessions (with real IDs) and new sessions (with temporary IDs).
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import MobileNav from './components/MobileNav';
import ToolsSettings from './components/ToolsSettings';
import QuickSettingsPanel from './components/QuickSettingsPanel';

import { useWebSocket } from './utils/websocket';
import { ThemeProvider } from './contexts/ThemeContext';
import { useVersionCheck } from './hooks/useVersionCheck';


// Main App component with routing
function AppContent() {
  const navigate = useNavigate();
  const { sessionId } = useParams();
  
  const { updateAvailable, latestVersion, currentVersion } = useVersionCheck('ItsAChillBear', 'claudecodeui');
  const [showVersionModal, setShowVersionModal] = useState(false);
  
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [targetSessionId, setTargetSessionId] = useState(null);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'files'
  const [isMobile, setIsMobile] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [showToolsSettings, setShowToolsSettings] = useState(false);
  const [showQuickSettings, setShowQuickSettings] = useState(false);
  const [autoExpandTools, setAutoExpandTools] = useState(() => {
    const saved = localStorage.getItem('autoExpandTools');
    return saved !== null ? JSON.parse(saved) : false;
  });
  const [showRawParameters, setShowRawParameters] = useState(() => {
    const saved = localStorage.getItem('showRawParameters');
    return saved !== null ? JSON.parse(saved) : false;
  });
  const [autoScrollToBottom, setAutoScrollToBottom] = useState(() => {
    const saved = localStorage.getItem('autoScrollToBottom');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth');
    return saved !== null ? parseInt(saved, 10) : 420; // Default 420px (320px + 100px)
  });
  const [isResizing, setIsResizing] = useState(false);
  // Session Protection System: Track sessions with active conversations to prevent
  // automatic project updates from interrupting ongoing chats. When a user sends
  // a message, the session is marked as "active" and project updates are paused
  // until the conversation completes or is aborted.
  const [activeSessions, setActiveSessions] = useState(new Set()); // Track sessions with active conversations
  
  const { ws, sendMessage, messages } = useWebSocket();

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    // Fetch projects on component mount
    fetchProjects();
  }, []);

  // Helper function to determine if an update is purely additive (new sessions/projects)
  // vs modifying existing selected items that would interfere with active conversations
  const isUpdateAdditive = (currentProjects, updatedProjects, selectedProject, selectedSession) => {
    if (!selectedProject || !selectedSession) {
      // No active session to protect, allow all updates
      return true;
    }

    // Find the selected project in both current and updated data
    const currentSelectedProject = currentProjects?.find(p => p.name === selectedProject.name);
    const updatedSelectedProject = updatedProjects?.find(p => p.name === selectedProject.name);

    if (!currentSelectedProject || !updatedSelectedProject) {
      // Project structure changed significantly, not purely additive
      return false;
    }

    // Find the selected session in both current and updated project data
    const currentSelectedSession = currentSelectedProject.sessions?.find(s => s.id === selectedSession.id);
    const updatedSelectedSession = updatedSelectedProject.sessions?.find(s => s.id === selectedSession.id);

    if (!currentSelectedSession || !updatedSelectedSession) {
      // Selected session was deleted or significantly changed, not purely additive
      return false;
    }

    // Check if the selected session's content has changed (modification vs addition)
    // Compare key fields that would affect the loaded chat interface
    const sessionUnchanged = 
      currentSelectedSession.id === updatedSelectedSession.id &&
      currentSelectedSession.title === updatedSelectedSession.title &&
      currentSelectedSession.created_at === updatedSelectedSession.created_at &&
      currentSelectedSession.updated_at === updatedSelectedSession.updated_at;

    // This is considered additive if the selected session is unchanged
    // (new sessions may have been added elsewhere, but active session is protected)
    return sessionUnchanged;
  };

  // Handle WebSocket messages for real-time project updates
  useEffect(() => {
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      
      if (latestMessage.type === 'projects_updated') {
        
        // Session Protection Logic: Allow additions but prevent changes during active conversations
        // This allows new sessions/projects to appear in sidebar while protecting active chat messages
        // We check for two types of active sessions:
        // 1. Existing sessions: selectedSession.id exists in activeSessions
        // 2. New sessions: temporary "new-session-*" identifiers in activeSessions (before real session ID is received)
        const hasActiveSession = (selectedSession && activeSessions.has(selectedSession.id)) ||
                                 (activeSessions.size > 0 && Array.from(activeSessions).some(id => id.startsWith('new-session-')));
        
        if (hasActiveSession) {
          // Allow updates but be selective: permit additions, prevent changes to existing items
          const updatedProjects = latestMessage.projects;
          const currentProjects = projects;
          
          // Check if this is purely additive (new sessions/projects) vs modification of existing ones
          const isAdditiveUpdate = isUpdateAdditive(currentProjects, updatedProjects, selectedProject, selectedSession);
          
          if (!isAdditiveUpdate) {
            // Skip updates that would modify existing selected session/project
            return;
          }
          // Continue with additive updates below
        }
        
        // Update projects state with the new data from WebSocket
        const updatedProjects = latestMessage.projects;
        setProjects(updatedProjects);
        
        // Update selected project if it exists in the updated projects
        if (selectedProject) {
          const updatedSelectedProject = updatedProjects.find(p => p.name === selectedProject.name);
          if (updatedSelectedProject) {
            setSelectedProject(updatedSelectedProject);
            
            // Update selected session only if it was deleted - avoid unnecessary reloads
            if (selectedSession) {
              const updatedSelectedSession = updatedSelectedProject.sessions?.find(s => s.id === selectedSession.id);
              if (!updatedSelectedSession) {
                // Session was deleted
                setSelectedSession(null);
              }
              // Don't update if session still exists with same ID - prevents reload
            }
          }
        }
      }
    }
  }, [messages, selectedProject, selectedSession, activeSessions]);

  const fetchProjects = async () => {
    try {
      setIsLoadingProjects(true);
      const response = await fetch('/api/projects');
      const data = await response.json();
      
      // Restore placeholder sessions from localStorage
      const storedPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      
      // Clean up old placeholders (older than 24 hours)
      const validPlaceholders = {};
      Object.entries(storedPlaceholders).forEach(([sessionId, placeholderData]) => {
        if (now - placeholderData.createdAt < maxAge) {
          validPlaceholders[sessionId] = placeholderData;
        }
      });
      
      // Update localStorage with cleaned placeholders
      if (Object.keys(validPlaceholders).length !== Object.keys(storedPlaceholders).length) {
        localStorage.setItem('placeholderSessions', JSON.stringify(validPlaceholders));
      }
      
      // Add placeholder sessions back to their respective projects
      const dataWithPlaceholders = data.map(project => {
        const projectPlaceholders = Object.entries(validPlaceholders)
          .filter(([sessionId, placeholderData]) => placeholderData.projectName === project.name)
          .map(([sessionId, placeholderData]) => ({
            id: sessionId,
            title: placeholderData.title,
            summary: placeholderData.summary,
            created_at: placeholderData.created_at,
            updated_at: placeholderData.updated_at,
            lastActivity: placeholderData.lastActivity,
            isPlaceholder: true
          }));
        
        if (projectPlaceholders.length > 0) {
          return {
            ...project,
            sessions: [...projectPlaceholders, ...(project.sessions || [])],
            sessionMeta: {
              ...project.sessionMeta,
              total: (project.sessionMeta?.total || 0) + projectPlaceholders.length
            }
          };
        }
        
        return project;
      });
      
      // Optimize to preserve object references when data hasn't changed
      setProjects(prevProjects => {
        // If no previous projects, just set the new data
        if (prevProjects.length === 0) {
          return dataWithPlaceholders;
        }
        
        // Check if the projects data has actually changed
        const hasChanges = dataWithPlaceholders.some((newProject, index) => {
          const prevProject = prevProjects[index];
          if (!prevProject) return true;
          
          // Compare key properties that would affect UI
          return (
            newProject.name !== prevProject.name ||
            newProject.displayName !== prevProject.displayName ||
            newProject.fullPath !== prevProject.fullPath ||
            JSON.stringify(newProject.sessionMeta) !== JSON.stringify(prevProject.sessionMeta) ||
            JSON.stringify(newProject.sessions) !== JSON.stringify(prevProject.sessions)
          );
        }) || dataWithPlaceholders.length !== prevProjects.length;
        
        // Only update if there are actual changes
        return hasChanges ? dataWithPlaceholders : prevProjects;
      });
      
      // Don't auto-select any project - user should choose manually
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  // Expose fetchProjects globally for component access
  window.refreshProjects = fetchProjects;

  // Handle URL-based session loading
  useEffect(() => {
    if (sessionId && projects.length > 0) {
      // Only switch tabs on initial load, not on every project update
      const shouldSwitchTab = !selectedSession || selectedSession.id !== sessionId;
      // Find the session across all projects
      for (const project of projects) {
        const session = project.sessions?.find(s => s.id === sessionId);
        if (session) {
          setSelectedProject(project);
          setSelectedSession(session);
          // Only switch to chat tab if we're loading a different session
          if (shouldSwitchTab) {
            setActiveTab('chat');
          }
          return;
        }
      }
      
      // If session not found, it might be a newly created session
      // Just navigate to it and it will be found when the sidebar refreshes
      // Don't redirect to home, let the session load naturally
    }
  }, [sessionId, projects, navigate]);

  const handleProjectSelect = (project) => {
    setSelectedProject(project);
    setSelectedSession(null);
    navigate('/');
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const handleSessionSelect = (session) => {
    setSelectedSession(session);
    setSelectedConversation(null); // Clear conversation when selecting individual session
    setTargetSessionId(null);
    // Only switch to chat tab when user explicitly selects a session
    // This prevents tab switching during automatic updates
    if (activeTab !== 'git' && activeTab !== 'preview') {
      setActiveTab('chat');
    }
    if (isMobile) {
      setSidebarOpen(false);
    }
    navigate(`/session/${session.id}`);
  };

  const handleConversationSelect = (conversation, targetSessionId = null) => {
    setSelectedConversation(conversation);
    setSelectedSession(null); // Clear individual session when selecting conversation
    setTargetSessionId(targetSessionId);
    // Only switch to chat tab when user explicitly selects a conversation
    if (activeTab !== 'git' && activeTab !== 'preview') {
      setActiveTab('chat');
    }
    if (isMobile) {
      setSidebarOpen(false);
    }
    // Navigate to the conversation view (using the most recent session ID for URL)
    const mostRecentSession = conversation.sessions.reduce((latest, current) => 
      new Date(current.lastActivity) > new Date(latest.lastActivity) ? current : latest
    );
    navigate(`/conversation/${mostRecentSession.id}${targetSessionId ? `#${targetSessionId}` : ''}`);
  };

  const handleNewSession = (project) => {
    // Create a temporary placeholder session that appears immediately in sidebar
    const placeholderSessionId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const placeholderSession = {
      id: placeholderSessionId,
      title: 'New Conversation',
      summary: 'New Conversation',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      isPlaceholder: true // Mark as placeholder
    };

    // Persist placeholder session to localStorage
    const existingPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
    existingPlaceholders[placeholderSessionId] = {
      ...placeholderSession,
      projectName: project.name,
      createdAt: Date.now()
    };
    localStorage.setItem('placeholderSessions', JSON.stringify(existingPlaceholders));

    // Add placeholder session to the project
    setProjects(prevProjects => 
      prevProjects.map(p => {
        if (p.name === project.name) {
          return {
            ...p,
            sessions: [placeholderSession, ...(p.sessions || [])],
            sessionMeta: {
              ...p.sessionMeta,
              total: (p.sessionMeta?.total || 0) + 1
            }
          };
        }
        return p;
      })
    );

    // Update selected project to include the new session
    const updatedProject = {
      ...project,
      sessions: [placeholderSession, ...(project.sessions || [])],
      sessionMeta: {
        ...project.sessionMeta,
        total: (project.sessionMeta?.total || 0) + 1
      }
    };

    setSelectedProject(updatedProject);
    setSelectedSession(placeholderSession);
    setActiveTab('chat');
    navigate(`/session/${placeholderSessionId}`);
    if (isMobile) {
      setSidebarOpen(false);
    }
  };

  const handleSessionDelete = (sessionId) => {
    // Clean up placeholder from localStorage if it's a placeholder session
    const storedPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
    if (storedPlaceholders[sessionId]) {
      delete storedPlaceholders[sessionId];
      localStorage.setItem('placeholderSessions', JSON.stringify(storedPlaceholders));
    }

    // If the deleted session was currently selected, clear it
    if (selectedSession?.id === sessionId) {
      setSelectedSession(null);
      navigate('/');
    }
    
    // Update projects state locally instead of full refresh
    setProjects(prevProjects => 
      prevProjects.map(project => ({
        ...project,
        sessions: project.sessions?.filter(session => session.id !== sessionId) || [],
        sessionMeta: {
          ...project.sessionMeta,
          total: Math.max(0, (project.sessionMeta?.total || 0) - 1)
        }
      }))
    );
  };



  const handleSidebarRefresh = async () => {
    // Refresh only the sessions for all projects, don't change selected state
    try {
      const response = await fetch('/api/projects');
      const freshProjects = await response.json();
      
      // Optimize to preserve object references and minimize re-renders
      setProjects(prevProjects => {
        // Check if projects data has actually changed
        const hasChanges = freshProjects.some((newProject, index) => {
          const prevProject = prevProjects[index];
          if (!prevProject) return true;
          
          return (
            newProject.name !== prevProject.name ||
            newProject.displayName !== prevProject.displayName ||
            newProject.fullPath !== prevProject.fullPath ||
            JSON.stringify(newProject.sessionMeta) !== JSON.stringify(prevProject.sessionMeta) ||
            JSON.stringify(newProject.sessions) !== JSON.stringify(prevProject.sessions)
          );
        }) || freshProjects.length !== prevProjects.length;
        
        return hasChanges ? freshProjects : prevProjects;
      });
      
      // If we have a selected project, make sure it's still selected after refresh
      if (selectedProject) {
        const refreshedProject = freshProjects.find(p => p.name === selectedProject.name);
        if (refreshedProject) {
          // Only update selected project if it actually changed
          if (JSON.stringify(refreshedProject) !== JSON.stringify(selectedProject)) {
            setSelectedProject(refreshedProject);
          }
          
          // If we have a selected session, try to find it in the refreshed project
          if (selectedSession) {
            const refreshedSession = refreshedProject.sessions?.find(s => s.id === selectedSession.id);
            if (refreshedSession && JSON.stringify(refreshedSession) !== JSON.stringify(selectedSession)) {
              setSelectedSession(refreshedSession);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  };

  const handleProjectDelete = (projectName) => {
    // If the deleted project was currently selected, clear it
    if (selectedProject?.name === projectName) {
      setSelectedProject(null);
      setSelectedSession(null);
      navigate('/');
    }
    
    // Update projects state locally instead of full refresh
    setProjects(prevProjects => 
      prevProjects.filter(project => project.name !== projectName)
    );
  };

  // Session Protection Functions: Manage the lifecycle of active sessions
  
  // markSessionAsActive: Called when user sends a message to mark session as protected
  // This includes both real session IDs and temporary "new-session-*" identifiers
  const markSessionAsActive = (sessionId) => {
    if (sessionId) {
      setActiveSessions(prev => new Set([...prev, sessionId]));
    }
  };

  // markSessionAsInactive: Called when conversation completes/aborts to re-enable project updates
  const markSessionAsInactive = (sessionId) => {
    if (sessionId) {
      setActiveSessions(prev => {
        const newSet = new Set(prev);
        newSet.delete(sessionId);
        return newSet;
      });
    }
  };

  // replaceTemporarySession: Called when WebSocket provides real session ID for new sessions
  // Removes temporary "new-session-*" identifiers and adds the real session ID
  // This maintains protection continuity during the transition from temporary to real session
  const replaceTemporarySession = (realSessionId) => {
    if (realSessionId) {
      setActiveSessions(prev => {
        const newSet = new Set();
        // Keep all non-temporary sessions and add the real session ID
        for (const sessionId of prev) {
          if (!sessionId.startsWith('new-session-')) {
            newSet.add(sessionId);
          }
        }
        newSet.add(realSessionId);
        return newSet;
      });
    }
  };

  // replacePlaceholderSession: Called when a real session is created to replace placeholder
  const replacePlaceholderSession = (realSessionId, placeholderSessionId) => {
    if (realSessionId && placeholderSessionId) {
      // Clean up placeholder from localStorage
      const existingPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
      delete existingPlaceholders[placeholderSessionId];
      localStorage.setItem('placeholderSessions', JSON.stringify(existingPlaceholders));

      // Remove placeholder session ID from active sessions and add real session ID
      setActiveSessions(prev => {
        const newSet = new Set(prev);
        newSet.delete(placeholderSessionId);
        newSet.add(realSessionId);
        return newSet;
      });
    }
  };

  // updateSessionActivity: Immediately update session metadata when new messages are sent
  // This provides instant visual feedback in the sidebar during active conversations
  const updateSessionActivity = (activityData) => {
    const { sessionId, lastActivity, messageContent, increment } = activityData;
    
    if (!sessionId || !selectedProject) return;
    
    setProjects(prevProjects => 
      prevProjects.map(project => {
        if (project.name === selectedProject.name) {
          return {
            ...project,
            sessions: (project.sessions || []).map(session => {
              if (session.id === sessionId) {
                const updates = {
                  ...session,
                  lastActivity: lastActivity || session.lastActivity
                };
                
                // Increment message count if requested
                if (increment) {
                  updates.messageCount = (session.messageCount || 0) + 1;
                }
                
                // Update summary for new conversations if messageContent provided
                if (messageContent && (!session.summary || session.summary === 'New Conversation' || session.isPlaceholder)) {
                  const summary = messageContent.length > 50 ? 
                    messageContent.substring(0, 50) + '...' : 
                    messageContent;
                  updates.summary = summary;
                  updates.title = summary; // Also update title for consistency
                }
                
                return updates;
              }
              return session;
            })
          };
        }
        return project;
      })
    );

    // Also update selected project if it matches
    if (selectedProject) {
      setSelectedProject(prevProject => {
        if (prevProject.name === selectedProject.name) {
          return {
            ...prevProject,
            sessions: (prevProject.sessions || []).map(session => {
              if (session.id === sessionId) {
                const updates = {
                  ...session,
                  lastActivity: lastActivity || session.lastActivity
                };
                
                if (increment) {
                  updates.messageCount = (session.messageCount || 0) + 1;
                }
                
                if (messageContent && (!session.summary || session.summary === 'New Conversation' || session.isPlaceholder)) {
                  const summary = messageContent.length > 50 ? 
                    messageContent.substring(0, 50) + '...' : 
                    messageContent;
                  updates.summary = summary;
                  updates.title = summary;
                }
                
                return updates;
              }
              return session;
            })
          };
        }
        return prevProject;
      });
    }
  };

  // Version Upgrade Modal Component
  const VersionUpgradeModal = () => {
    if (!showVersionModal) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm"
          onClick={() => setShowVersionModal(false)}
        />
        
        {/* Modal */}
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-md mx-4 p-6 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Update Available</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">A new version is ready</p>
              </div>
            </div>
            <button
              onClick={() => setShowVersionModal(false)}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Version Info */}
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Version</span>
              <span className="text-sm text-gray-900 dark:text-white font-mono">{currentVersion}</span>
            </div>
            <div className="flex justify-between items-center p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
              <span className="text-sm font-medium text-blue-700 dark:text-blue-300">Latest Version</span>
              <span className="text-sm text-blue-900 dark:text-blue-100 font-mono">{latestVersion}</span>
            </div>
          </div>

          {/* Upgrade Instructions */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-900 dark:text-white">How to upgrade:</h3>
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 border">
              <code className="text-sm text-gray-800 dark:text-gray-200 font-mono">
                git checkout main && git pull && npm install
              </code>
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Run this command in your Claude Code UI directory to update to the latest version.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={() => setShowVersionModal(false)}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
            >
              Later
            </button>
            <button
              onClick={() => {
                // Copy command to clipboard
                navigator.clipboard.writeText('git checkout main && git pull && npm install');
                setShowVersionModal(false);
              }}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Copy Command
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Handle sidebar resizing
  const handleMouseDown = (e) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      
      const newWidth = e.clientX;
      // Set min/max width constraints
      const constrainedWidth = Math.max(280, Math.min(600, newWidth));
      setSidebarWidth(constrainedWidth);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        // Save to localStorage
        localStorage.setItem('sidebarWidth', sidebarWidth.toString());
      }
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, sidebarWidth]);

  return (
    <div className={`fixed inset-0 flex bg-background ${isResizing ? 'select-none' : ''}`}>
      {/* Fixed Desktop Sidebar */}
      {!isMobile && (
        <div 
          className="flex-shrink-0 border-r border-border bg-card relative"
          style={{ width: `${sidebarWidth}px` }}
        >
          <div className="h-full overflow-hidden">
            <Sidebar
              projects={projects}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              onProjectSelect={handleProjectSelect}
              onSessionSelect={handleSessionSelect}
              onConversationSelect={handleConversationSelect}
              onNewSession={handleNewSession}
              onSessionDelete={handleSessionDelete}
              onProjectDelete={handleProjectDelete}
              isLoading={isLoadingProjects}
              onRefresh={handleSidebarRefresh}
              onShowSettings={() => setShowToolsSettings(true)}
              updateAvailable={updateAvailable}
              latestVersion={latestVersion}
              currentVersion={currentVersion}
              onShowVersionModal={() => setShowVersionModal(true)}
            />
          </div>
          {/* Resize Handle */}
          <div
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors group"
            onMouseDown={handleMouseDown}
            style={{
              width: '6px',
              marginRight: '-3px',
              zIndex: 10
            }}
          >
            {/* Visual indicator on hover */}
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-0.5 h-8 bg-border rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      )}

      {/* Mobile Sidebar Overlay */}
      {isMobile && (
        <div className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${
          sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}>
          <div 
            className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(e) => {
              e.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSidebarOpen(false);
            }}
          />
          <div 
            className={`relative w-[85vw] max-w-sm sm:w-80 bg-card border-r border-border h-full transform transition-transform duration-150 ease-out ${
              sidebarOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
            <Sidebar
              projects={projects}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              onProjectSelect={handleProjectSelect}
              onSessionSelect={handleSessionSelect}
              onConversationSelect={handleConversationSelect}
              onNewSession={handleNewSession}
              onSessionDelete={handleSessionDelete}
              onProjectDelete={handleProjectDelete}
              isLoading={isLoadingProjects}
              onRefresh={handleSidebarRefresh}
              onShowSettings={() => setShowToolsSettings(true)}
              updateAvailable={updateAvailable}
              latestVersion={latestVersion}
              currentVersion={currentVersion}
              onShowVersionModal={() => setShowVersionModal(true)}
            />
          </div>
        </div>
      )}

      {/* Main Content Area - Flexible */}
      <div className="flex-1 flex flex-col min-w-0">
        <MainContent
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          selectedConversation={selectedConversation}
          targetSessionId={targetSessionId}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          messages={messages}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionActive={markSessionAsActive}
          onSessionInactive={markSessionAsInactive}
          onReplaceTemporarySession={replaceTemporarySession}
          onReplacePlaceholderSession={replacePlaceholderSession}
          onNavigateToSession={(sessionId) => navigate(`/session/${sessionId}`)}
          onShowSettings={() => setShowToolsSettings(true)}
          autoExpandTools={autoExpandTools}
          showRawParameters={showRawParameters}
          onProjectUpdate={fetchProjects}
          onUpdateSessionActivity={updateSessionActivity}
        />
      </div>

      {/* Mobile Bottom Navigation */}
      {isMobile && (
        <MobileNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isInputFocused={isInputFocused}
        />
      )}
      {/* Quick Settings Panel - Only show on chat tab */}
      {activeTab === 'chat' && (
        <QuickSettingsPanel
          isOpen={showQuickSettings}
          onToggle={setShowQuickSettings}
          autoExpandTools={autoExpandTools}
          onAutoExpandChange={(value) => {
            setAutoExpandTools(value);
            localStorage.setItem('autoExpandTools', JSON.stringify(value));
          }}
          showRawParameters={showRawParameters}
          onShowRawParametersChange={(value) => {
            setShowRawParameters(value);
            localStorage.setItem('showRawParameters', JSON.stringify(value));
          }}
          autoScrollToBottom={autoScrollToBottom}
          onAutoScrollChange={(value) => {
            setAutoScrollToBottom(value);
            localStorage.setItem('autoScrollToBottom', JSON.stringify(value));
          }}
          isMobile={isMobile}
        />
      )}

      {/* Tools Settings Modal */}
      <ToolsSettings
        isOpen={showToolsSettings}
        onClose={() => setShowToolsSettings(false)}
      />

      {/* Version Upgrade Modal */}
      <VersionUpgradeModal />
    </div>
  );
}

// Root App component with router
function App() {
  return (
    <ThemeProvider>
      <Router>
        <Routes>
          <Route path="/" element={<AppContent />} />
          <Route path="/session/:sessionId" element={<AppContent />} />
          <Route path="/conversation/:sessionId" element={<AppContent />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;