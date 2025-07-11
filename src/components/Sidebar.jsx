import React, { useState, useEffect } from 'react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { FolderOpen, Folder, Plus, MessageSquare, Clock, ChevronDown, ChevronRight, Edit3, Check, X, Trash2, Settings, FolderPlus, RefreshCw, Sparkles, Edit2 } from 'lucide-react';
import { cn } from '../lib/utils';
import ClaudeLogo from './ClaudeLogo';

// Move formatTimeAgo outside component to avoid recreation on every render
const formatTimeAgo = (dateString, currentTime) => {
  const date = new Date(dateString);
  const now = currentTime;
  
  // Check if date is valid
  if (isNaN(date.getTime())) {
    return 'Unknown';
  }
  
  const diffInMs = now - date;
  const diffInSeconds = Math.floor(diffInMs / 1000);
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  
  if (diffInSeconds < 60) return 'Just now';
  if (diffInMinutes === 1) return '1 min ago';
  if (diffInMinutes < 60) return `${diffInMinutes} mins ago`;
  if (diffInHours === 1) return '1 hour ago';
  if (diffInHours < 24) return `${diffInHours} hours ago`;
  if (diffInDays === 1) return '1 day ago';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  return date.toLocaleDateString();
};

function Sidebar({ 
  projects, 
  selectedProject, 
  selectedSession, 
  onProjectSelect, 
  onSessionSelect, 
  onConversationSelect,
  onNewSession,
  onSessionDelete,
  onProjectDelete,
  isLoading,
  onRefresh,
  onShowSettings,
  updateAvailable,
  latestVersion,
  currentVersion,
  onShowVersionModal
}) {
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [expandedConversations, setExpandedConversations] = useState(new Set());
  const [editingProject, setEditingProject] = useState(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [editingConversation, setEditingConversation] = useState(null);
  const [editingConversationName, setEditingConversationName] = useState('');
  const [generatingSummary, setGeneratingSummary] = useState({});

  // Touch handler to prevent double-tap issues on iPad
  const handleTouchClick = (callback) => {
    return (e) => {
      e.preventDefault();
      e.stopPropagation();
      callback();
    };
  };

  // Auto-update timestamps every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every 60 seconds

    return () => clearInterval(timer);
  }, []);

  // Clear cache when projects list changes (e.g., after refresh)
  useEffect(() => {
    // Projects have been refreshed
  }, [projects]);

  // Auto-expand project folder when a session is selected
  useEffect(() => {
    if (selectedSession && selectedProject) {
      setExpandedProjects(prev => new Set([...prev, selectedProject.name]));
    }
  }, [selectedSession, selectedProject]);



  const toggleProject = (projectName) => {
    const newExpanded = new Set(expandedProjects);
    if (newExpanded.has(projectName)) {
      newExpanded.delete(projectName);
    } else {
      newExpanded.add(projectName);
    }
    setExpandedProjects(newExpanded);
  };

  const toggleConversation = (conversationId) => {
    const newExpanded = new Set(expandedConversations);
    if (newExpanded.has(conversationId)) {
      newExpanded.delete(conversationId);
    } else {
      newExpanded.add(conversationId);
    }
    setExpandedConversations(newExpanded);
  };


  const startEditing = (project) => {
    setEditingProject(project.name);
    setEditingName(project.displayName);
  };

  const cancelEditing = () => {
    setEditingProject(null);
    setEditingName('');
  };

  const saveProjectName = async (projectName) => {
    try {
      const response = await fetch(`/api/projects/${projectName}/rename`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ displayName: editingName }),
      });

      if (response.ok) {
        // Refresh projects to get updated data
        if (window.refreshProjects) {
          window.refreshProjects();
        } else {
          window.location.reload();
        }
      } else {
        console.error('Failed to rename project');
      }
    } catch (error) {
      console.error('Error renaming project:', error);
    }
    
    setEditingProject(null);
    setEditingName('');
  };

  const deleteSession = async (projectName, sessionId) => {
    if (!confirm('Are you sure you want to delete this message? This action cannot be undone.')) {
      return;
    }

    try {
      // First, clear placeholder session from localStorage if it's a placeholder
      if (sessionId.startsWith('temp-')) {
        const storedPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
        if (storedPlaceholders[sessionId]) {
          delete storedPlaceholders[sessionId];
          localStorage.setItem('placeholderSessions', JSON.stringify(storedPlaceholders));
          console.log(`🗑️ Cleared placeholder session: ${sessionId}`);
        }
      }

      // Then delete server-side session (will gracefully handle temp sessions)
      const response = await fetch(`/api/projects/${projectName}/sessions/${sessionId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Call parent callback if provided
        if (onSessionDelete) {
          onSessionDelete(sessionId);
        }
      } else {
        console.error('Failed to delete session');
        alert('Failed to delete message. Please try again.');
      }
    } catch (error) {
              console.error('Error deleting session:', error);
        alert('Error deleting message. Please try again.');
    }
  };

  const deleteAllSessions = async (projectName) => {
    const project = projects.find(p => p.name === projectName);
    const visibleSessions = getAllSessions(project);
    const conversations = groupSessionsIntoConversations(visibleSessions);
    const conversationCount = conversations.length;
    
    if (conversationCount === 0) {
      alert('No conversations to delete.');
      return;
    }

    // Count total messages/sessions across all conversations
    const totalMessages = conversations.reduce((sum, conv) => sum + conv.sessions.length, 0);
    const conversationText = `ALL ${conversationCount} conversation${conversationCount === 1 ? '' : 's'} (containing ${totalMessages} message${totalMessages === 1 ? '' : 's'})`;

    if (!confirm(`Are you sure you want to delete ${conversationText} for this project? This action cannot be undone.`)) {
      return;
    }

    try {
      // First, clear placeholder sessions from localStorage for this project
      const storedPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
      const updatedPlaceholders = {};
      
      // Keep only placeholder sessions that don't belong to this project
      Object.entries(storedPlaceholders).forEach(([sessionId, placeholderData]) => {
        if (placeholderData.projectName !== projectName) {
          updatedPlaceholders[sessionId] = placeholderData;
        }
      });
      
      localStorage.setItem('placeholderSessions', JSON.stringify(updatedPlaceholders));
      console.log(`🗑️ Cleared placeholder sessions for project: ${projectName}`);

      // Then delete server-side sessions
      const response = await fetch(`/api/projects/${projectName}/sessions`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Refresh projects to update session counts
        if (window.refreshProjects) {
          window.refreshProjects();
        } else {
          window.location.reload();
        }
        
        // If currently viewing a session from this project, clear it
        if (selectedProject?.name === projectName) {
          onSessionSelect(null);
        }
      } else {
        console.error('Failed to delete all conversations');
        alert('Failed to delete all conversations. Please try again.');
      }
    } catch (error) {
      console.error('Error deleting all conversations:', error);
      alert('Error deleting all conversations. Please try again.');
    }
  };

  const deleteProject = async (projectName) => {
    if (!confirm('Are you sure you want to delete this empty project? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectName}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Call parent callback if provided
        if (onProjectDelete) {
          onProjectDelete(projectName);
        }
      } else {
        const error = await response.json();
        console.error('Failed to delete project');
        alert(error.error || 'Failed to delete project. Please try again.');
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      alert('Error deleting project. Please try again.');
    }
  };

  const updateSessionSummary = async (projectName, sessionId, newSummary) => {
    try {
      const response = await fetch(`/api/projects/${projectName}/sessions/${sessionId}/summary`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ summary: newSummary }),
      });

      if (response.ok) {
        // Refresh projects to get updated data
        if (window.refreshProjects) {
          window.refreshProjects();
        } else {
          window.location.reload();
        }
      } else {
        console.error('Failed to update session summary');
      }
    } catch (error) {
      console.error('Error updating session summary:', error);
    }
  };

  const deleteConversation = async (projectName, conversation) => {
    const sessionCount = conversation.sessions.length;
    if (!confirm(`Are you sure you want to delete this conversation with ${sessionCount} message${sessionCount === 1 ? '' : 's'}? This action cannot be undone.`)) {
      return;
    }

    try {
      // First, clear placeholder sessions from localStorage for this conversation
      const storedPlaceholders = JSON.parse(localStorage.getItem('placeholderSessions') || '{}');
      const updatedPlaceholders = { ...storedPlaceholders };
      
      // Remove placeholder sessions that belong to this conversation
      conversation.sessions.forEach(session => {
        if (session.isPlaceholder && updatedPlaceholders[session.id]) {
          delete updatedPlaceholders[session.id];
          console.log(`🗑️ Cleared placeholder session: ${session.id}`);
        }
      });
      
      localStorage.setItem('placeholderSessions', JSON.stringify(updatedPlaceholders));

      // Delete all sessions in the conversation (server-side sessions)
      for (const session of conversation.sessions) {
        // Skip placeholder sessions as they don't exist on the server
        if (session.isPlaceholder) {
          continue;
        }
        
        const response = await fetch(`/api/projects/${projectName}/sessions/${session.id}`, {
          method: 'DELETE',
        });

        if (!response.ok) {
          console.error(`Failed to delete session ${session.id}`);
          alert('Failed to delete some messages. Please try again.');
          return;
        }
      }

      // Refresh projects to update session counts
      if (window.refreshProjects) {
        window.refreshProjects();
      } else {
        window.location.reload();
      }
      
      // If currently viewing a session from this conversation, clear it
      if (selectedSession && conversation.sessions.some(s => s.id === selectedSession.id)) {
        onSessionSelect(null);
      }
    } catch (error) {
      console.error('Error deleting conversation:', error);
      alert('Error deleting conversation. Please try again.');
    }
  };

  const startEditingConversation = (conversation) => {
    setEditingConversation(conversation.id);
    setEditingConversationName(conversation.title);
  };

  const cancelEditingConversation = () => {
    setEditingConversation(null);
    setEditingConversationName('');
  };

  const saveConversationTitle = async (projectName, conversation) => {
    // For now, we'll update the first session's summary as the conversation title
    // In a real implementation, you might want a separate conversation title field
    const firstSession = conversation.sessions[0];
    if (firstSession) {
      await updateSessionSummary(projectName, firstSession.id, editingConversationName);
    }
    setEditingConversation(null);
    setEditingConversationName('');
  };

  const createNewProject = async () => {
    if (!newProjectPath.trim()) {
      alert('Please enter a project path');
      return;
    }

    setCreatingProject(true);
    
    try {
      const response = await fetch('/api/projects/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          path: newProjectPath.trim()
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setShowNewProject(false);
        setNewProjectPath('');
        
        // Refresh projects to show the new one
        if (window.refreshProjects) {
          window.refreshProjects();
        } else {
          window.location.reload();
        }
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to create project. Please try again.');
      }
    } catch (error) {
      console.error('Error creating project:', error);
      alert('Error creating project. Please try again.');
    } finally {
      setCreatingProject(false);
    }
  };

  const cancelNewProject = () => {
    setShowNewProject(false);
    setNewProjectPath('');
  };


  // Helper function to get all sessions for a project
  const getAllSessions = (project) => {
    return project.sessions || [];
  };

  // Helper function to group sessions into conversations
  const groupSessionsIntoConversations = (sessions) => {
    const conversations = [];
    const processedSessions = new Set();
    
    // Get conversation associations from localStorage
    const conversationAssociations = JSON.parse(localStorage.getItem('conversationAssociations') || '{}');
    
    // First, group sessions that have explicit conversation associations
    const conversationGroups = new Map();
    
    sessions.forEach(session => {
      if (processedSessions.has(session.id)) return;
      
      // For placeholder sessions, always create individual conversations
      if (session.isPlaceholder) {
        conversations.push({
          id: `placeholder_${session.id}`,
          title: session.summary || 'New Conversation',
          sessions: [session],
          lastActivity: session.lastActivity,
          messageCount: session.messageCount || 0,
          isPlaceholder: true
        });
        processedSessions.add(session.id);
        return;
      }
      
      // Check if this session has a conversation association
      const conversationContext = conversationAssociations[session.id];
      if (conversationContext) {
        const conversationId = conversationContext.conversationId;
        
        if (!conversationGroups.has(conversationId)) {
          conversationGroups.set(conversationId, {
            id: conversationId,
            title: conversationContext.conversationTitle,
            sessions: [],
            lastActivity: session.lastActivity,
            messageCount: 0,
            isPlaceholder: false
          });
        }
        
        const group = conversationGroups.get(conversationId);
        group.sessions.push(session);
        group.messageCount += session.messageCount || 0;
        
        // Update last activity to the most recent
        if (new Date(session.lastActivity) > new Date(group.lastActivity)) {
          group.lastActivity = session.lastActivity;
        }
        
        processedSessions.add(session.id);
        return;
      }
      
      // For real sessions without conversation associations, apply legacy grouping logic
      // (Claude CLI duplication bug workaround)
      const relatedSessions = [session];
      processedSessions.add(session.id);
      
      const sessionTime = new Date(session.lastActivity);
      const sessionSummary = (session.summary || '').toLowerCase().trim();
      
      // Don't group sessions that were intentionally started as new conversations
      const isNewConversation = sessionSummary === 'new conversation' || sessionSummary === '';
      
      if (!isNewConversation) {
        // Look for other sessions that might be related (only for Claude CLI duplication bug)
        sessions.forEach(otherSession => {
          if (processedSessions.has(otherSession.id) || otherSession.isPlaceholder) return;
          
          // Skip sessions that have conversation associations
          if (conversationAssociations[otherSession.id]) return;
          
          const otherTime = new Date(otherSession.lastActivity);
          const otherSummary = (otherSession.summary || '').toLowerCase().trim();
          const timeDiff = Math.abs(sessionTime - otherTime);
          
          // Don't group with "new conversation" sessions
          const otherIsNewConversation = otherSummary === 'new conversation' || otherSummary === '';
          if (otherIsNewConversation) return;
          
          let isRelated = false;
          
          // VERY restrictive criteria for grouping (only for Claude CLI duplication bug)
          if (timeDiff < 30000) { // 30 seconds - much tighter window
            // Both sessions must have meaningful summaries that are very similar
            if (sessionSummary && otherSummary && sessionSummary.length > 10 && otherSummary.length > 10) {
              // Calculate similarity percentage
              const longer = sessionSummary.length > otherSummary.length ? sessionSummary : otherSummary;
              const shorter = sessionSummary.length <= otherSummary.length ? sessionSummary : otherSummary;
              
              // Check for very high similarity (one summary contains most of the other)
              let matchingChars = 0;
              for (let i = 0; i < shorter.length; i++) {
                if (longer.includes(shorter[i])) {
                  matchingChars++;
                }
              }
              
              const similarity = matchingChars / longer.length;
              
              // Only group if 80%+ similar and very recent
              if (similarity > 0.8) {
                isRelated = true;
              }
            }
          }
          
          if (isRelated) {
            relatedSessions.push(otherSession);
            processedSessions.add(otherSession.id);
          }
        });
      }
      
      // Sort related sessions by activity time
      relatedSessions.sort((a, b) => new Date(a.lastActivity) - new Date(b.lastActivity));
      
      // Use the first session's summary as the conversation title
      const firstSession = relatedSessions[0];
      const conversationTitle = firstSession.summary || 'Conversation';
      
      conversations.push({
        id: `conv_${firstSession.id}`,
        title: relatedSessions.length > 1 ? 
          `${conversationTitle} (${relatedSessions.length} messages)` : 
          conversationTitle,
        sessions: relatedSessions,
        lastActivity: relatedSessions[relatedSessions.length - 1].lastActivity,
        messageCount: relatedSessions.reduce((sum, s) => sum + (s.messageCount || 0), 0),
        isPlaceholder: false
      });
    });
    
    // Add all conversation groups to the conversations array
    for (const group of conversationGroups.values()) {
      // Sort sessions within each conversation by activity time
      group.sessions.sort((a, b) => new Date(a.lastActivity) - new Date(b.lastActivity));
      
      // Update title to show message count if more than 1
      if (group.sessions.length > 1) {
        group.title = `${group.title} (${group.sessions.length} messages)`;
      }
      
      conversations.push(group);
    }
    
    return conversations.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  };

  return (
    <div className="h-full flex flex-col bg-card md:select-none">
      {/* Header */}
      <div className="md:p-4 md:border-b md:border-border">
        {/* Desktop Header */}
        <div className="hidden md:flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center shadow-sm">
              <MessageSquare className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">Claude Code UI</h1>
              <p className="text-sm text-muted-foreground">AI coding assistant interface</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 px-0 hover:bg-accent transition-colors duration-200 group"
              onClick={async () => {
                setIsRefreshing(true);
                try {
                  await onRefresh();
                } finally {
                  setIsRefreshing(false);
                }
              }}
              disabled={isRefreshing}
              title="Refresh projects and messages (Ctrl+R)"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''} group-hover:rotate-180 transition-transform duration-300`} />
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-9 w-9 px-0 bg-primary hover:bg-primary/90 transition-all duration-200 shadow-sm hover:shadow-md"
              onClick={() => setShowNewProject(true)}
              title="Create new project (Ctrl+N)"
            >
              <FolderPlus className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Mobile Header */}
        <div className="md:hidden p-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <MessageSquare className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">Claude Code UI</h1>
                <p className="text-sm text-muted-foreground">Projects</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="w-8 h-8 rounded-md bg-background border border-border flex items-center justify-center active:scale-95 transition-all duration-150"
                onClick={async () => {
                  setIsRefreshing(true);
                  try {
                    await onRefresh();
                  } finally {
                    setIsRefreshing(false);
                  }
                }}
                disabled={isRefreshing}
              >
                <RefreshCw className={`w-4 h-4 text-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              <button
                className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center active:scale-95 transition-all duration-150"
                onClick={() => setShowNewProject(true)}
              >
                <FolderPlus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* New Project Form */}
      {showNewProject && (
        <div className="md:p-3 md:border-b md:border-border md:bg-muted/30">
          {/* Desktop Form */}
          <div className="hidden md:block space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FolderPlus className="w-4 h-4" />
              Create New Project
            </div>
            <Input
              value={newProjectPath}
              onChange={(e) => setNewProjectPath(e.target.value)}
              placeholder="/path/to/project or relative/path"
              className="text-sm focus:ring-2 focus:ring-primary/20"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') createNewProject();
                if (e.key === 'Escape') cancelNewProject();
              }}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={createNewProject}
                disabled={!newProjectPath.trim() || creatingProject}
                className="flex-1 h-8 text-xs hover:bg-primary/90 transition-colors"
              >
                {creatingProject ? 'Creating...' : 'Create Project'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={cancelNewProject}
                disabled={creatingProject}
                className="h-8 text-xs hover:bg-accent transition-colors"
              >
                Cancel
              </Button>
            </div>
          </div>
          
          {/* Mobile Form - Simple Overlay */}
          <div className="md:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
            <div className="absolute bottom-0 left-0 right-0 bg-card rounded-t-lg border-t border-border p-4 space-y-4 animate-in slide-in-from-bottom duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-primary/10 rounded-md flex items-center justify-center">
                    <FolderPlus className="w-3 h-3 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">New Project</h2>
                  </div>
                </div>
                <button
                  onClick={cancelNewProject}
                  disabled={creatingProject}
                  className="w-6 h-6 rounded-md bg-muted flex items-center justify-center active:scale-95 transition-transform"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              
              <div className="space-y-3">
                <Input
                  value={newProjectPath}
                  onChange={(e) => setNewProjectPath(e.target.value)}
                  placeholder="/path/to/project or relative/path"
                  className="text-sm h-10 rounded-md focus:border-primary transition-colors"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createNewProject();
                    if (e.key === 'Escape') cancelNewProject();
                  }}
                />
                
                <div className="flex gap-2">
                  <Button
                    onClick={cancelNewProject}
                    disabled={creatingProject}
                    variant="outline"
                    className="flex-1 h-9 text-sm rounded-md active:scale-95 transition-transform"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={createNewProject}
                    disabled={!newProjectPath.trim() || creatingProject}
                    className="flex-1 h-9 text-sm rounded-md bg-primary hover:bg-primary/90 active:scale-95 transition-all"
                  >
                    {creatingProject ? 'Creating...' : 'Create'}
                  </Button>
                </div>
              </div>
              
              {/* Safe area for mobile */}
              <div className="h-4" />
            </div>
          </div>
        </div>
      )}
      
      {/* Projects List */}
      <ScrollArea className="flex-1 md:px-2 md:py-3 overflow-y-auto overscroll-contain">
        <div className="md:space-y-1 pb-safe-area-inset-bottom">
          {isLoading ? (
            <div className="text-center py-12 md:py-8 px-4">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4 md:mb-3">
                <div className="w-6 h-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              </div>
              <h3 className="text-base font-medium text-foreground mb-2 md:mb-1">Loading projects...</h3>
              <p className="text-sm text-muted-foreground">
                Fetching your Claude projects and sessions
              </p>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-12 md:py-8 px-4">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4 md:mb-3">
                <Folder className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-medium text-foreground mb-2 md:mb-1">No projects found</h3>
              <p className="text-sm text-muted-foreground">
                Run Claude CLI in a project directory to get started
              </p>
            </div>
          ) : (
            projects.map((project) => {
              const isExpanded = expandedProjects.has(project.name);
              const isSelected = selectedProject?.name === project.name;
              
              return (
                <div key={project.name} className="md:space-y-1">
                  {/* Project Header */}
                  <div className="group md:group">
                    {/* Mobile Project Item */}
                    <div className="md:hidden">
                      <div
                        className={cn(
                          "p-3 mx-3 my-1 rounded-lg bg-card border border-border/50 active:scale-[0.98] transition-all duration-150",
                          isSelected && "bg-primary/5 border-primary/20"
                        )}
                        onClick={() => {
                          // On mobile, just toggle the folder - don't select the project
                          toggleProject(project.name);
                        }}
                        onTouchEnd={handleTouchClick(() => toggleProject(project.name))}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center transition-colors",
                              isExpanded ? "bg-primary/10" : "bg-muted"
                            )}>
                              {isExpanded ? (
                                <FolderOpen className="w-4 h-4 text-primary" />
                              ) : (
                                <Folder className="w-4 h-4 text-muted-foreground" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              {editingProject === project.name ? (
                                <input
                                  type="text"
                                  value={editingName}
                                  onChange={(e) => setEditingName(e.target.value)}
                                  className="w-full px-3 py-2 text-sm border-2 border-primary/40 focus:border-primary rounded-lg bg-background text-foreground shadow-sm focus:shadow-md transition-all duration-200 focus:outline-none"
                                  placeholder="Project name"
                                  autoFocus
                                  autoComplete="off"
                                  onClick={(e) => e.stopPropagation()}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveProjectName(project.name);
                                    if (e.key === 'Escape') cancelEditing();
                                  }}
                                  style={{
                                    fontSize: '16px', // Prevents zoom on iOS
                                    WebkitAppearance: 'none',
                                    borderRadius: '8px'
                                  }}
                                />
                              ) : (
                                <>
                                  <h3 className="text-sm font-medium text-foreground truncate">
                                    {project.displayName}
                                  </h3>
                                  <p className="text-xs text-muted-foreground">
                                    {(() => {
                                      const totalCount = project.sessionMeta?.total;
                                      if (totalCount !== undefined) {
                                        const convCount = groupSessionsIntoConversations(getAllSessions(project)).length;
                                        return `${convCount} conversation${convCount === 1 ? '' : 's'}`;
                                      }
                                      const sessionCount = getAllSessions(project).length;
                                      const hasMore = project.sessionMeta?.hasMore !== false;
                                      const convCount = groupSessionsIntoConversations(getAllSessions(project)).length;
                                      return `${convCount} conversation${convCount === 1 ? '' : 's'}`;
                                    })()}
                                  </p>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {editingProject === project.name ? (
                              <>
                                <button
                                  className="w-8 h-8 rounded-lg bg-green-500 dark:bg-green-600 flex items-center justify-center active:scale-90 transition-all duration-150 shadow-sm active:shadow-none"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveProjectName(project.name);
                                  }}
                                >
                                  <Check className="w-4 h-4 text-white" />
                                </button>
                                <button
                                  className="w-8 h-8 rounded-lg bg-gray-500 dark:bg-gray-600 flex items-center justify-center active:scale-90 transition-all duration-150 shadow-sm active:shadow-none"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEditing();
                                  }}
                                >
                                  <X className="w-4 h-4 text-white" />
                                </button>
                              </>
                            ) : (
                              <>
                                {getAllSessions(project).length === 0 && (
                                  <button
                                    className="w-8 h-8 rounded-lg bg-red-500/10 dark:bg-red-900/30 flex items-center justify-center active:scale-90 border border-red-200 dark:border-red-800"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteProject(project.name);
                                    }}
                                    onTouchEnd={handleTouchClick(() => deleteProject(project.name))}
                                  >
                                    <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400" />
                                  </button>
                                )}
                                <button
                                  className="w-8 h-8 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center active:scale-90 border border-primary/20 dark:border-primary/30"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEditing(project);
                                  }}
                                  onTouchEnd={handleTouchClick(() => startEditing(project))}
                                >
                                  <Edit3 className="w-4 h-4 text-primary" />
                                </button>
                                <div className="w-6 h-6 rounded-md bg-muted/30 flex items-center justify-center">
                                  {isExpanded ? (
                                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Desktop Project Item */}
                    <Button
                      variant="ghost"
                      className={cn(
                        "hidden md:flex w-full justify-between p-2 h-auto font-normal hover:bg-accent/50",
                        isSelected && "bg-accent text-accent-foreground"
                      )}
                      onClick={() => {
                        // Desktop behavior: select project and toggle
                        if (selectedProject?.name !== project.name) {
                          onProjectSelect(project);
                        }
                        toggleProject(project.name);
                      }}
                      onTouchEnd={handleTouchClick(() => {
                        if (selectedProject?.name !== project.name) {
                          onProjectSelect(project);
                        }
                        toggleProject(project.name);
                      })}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        {isExpanded ? (
                          <FolderOpen className="w-4 h-4 text-primary flex-shrink-0" />
                        ) : (
                          <Folder className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        )}
                        <div className="min-w-0 flex-1 text-left">
                          {editingProject === project.name ? (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground focus:ring-2 focus:ring-primary/20"
                                placeholder="Project name"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveProjectName(project.name);
                                  if (e.key === 'Escape') cancelEditing();
                                }}
                              />
                              <div className="text-xs text-muted-foreground truncate" title={project.fullPath}>
                                {project.fullPath}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="text-sm font-semibold truncate text-foreground" title={project.displayName}>
                                {project.displayName}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {(() => {
                                  const totalCount = project.sessionMeta?.total;
                                  if (totalCount !== undefined) {
                                    const convCount = groupSessionsIntoConversations(getAllSessions(project)).length;
                                    return convCount;
                                  }
                                  const sessionCount = getAllSessions(project).length;
                                  const hasMore = project.sessionMeta?.hasMore !== false;
                                  const convCount = groupSessionsIntoConversations(getAllSessions(project)).length;
                                  return convCount;
                                })()}
                                {project.fullPath !== project.displayName && (
                                  <span className="ml-1 opacity-60" title={project.fullPath}>
                                    • {project.fullPath.length > 25 ? '...' + project.fullPath.slice(-22) : project.fullPath}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {editingProject === project.name ? (
                          <>
                            <div
                              className="w-6 h-6 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20 flex items-center justify-center rounded cursor-pointer transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                saveProjectName(project.name);
                              }}
                            >
                              <Check className="w-3 h-3" />
                            </div>
                            <div
                              className="w-6 h-6 text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-center rounded cursor-pointer transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                cancelEditing();
                              }}
                            >
                              <X className="w-3 h-3" />
                            </div>
                          </>
                        ) : (
                          <>
                            <div
                              className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-accent flex items-center justify-center rounded cursor-pointer touch:opacity-100"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditing(project);
                              }}
                              title="Rename project (F2)"
                            >
                              <Edit3 className="w-3 h-3" />
                            </div>
                            {getAllSessions(project).length === 0 && (
                              <div
                                className="w-6 h-6 opacity-0 group-hover:opacity-100 transition-all duration-200 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center justify-center rounded cursor-pointer touch:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteProject(project.name);
                                }}
                                title="Delete empty project (Delete)"
                              >
                                <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
                              </div>
                            )}
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                            )}
                          </>
                        )}
                      </div>
                    </Button>
                  </div>

                  {/* Conversations List */}
                  {isExpanded && (
                    <div className="ml-3 space-y-1 border-l border-border pl-3">
                      {isLoading ? (
                        // Loading skeleton for conversations
                        Array.from({ length: 2 }).map((_, i) => (
                          <div key={i} className="p-2 rounded-md">
                            <div className="flex items-start gap-2">
                              <div className="w-3 h-3 bg-muted rounded-full animate-pulse mt-0.5" />
                              <div className="flex-1 space-y-1">
                                <div className="h-3 bg-muted rounded animate-pulse" style={{ width: `${60 + i * 15}%` }} />
                                <div className="h-2 bg-muted rounded animate-pulse w-1/2" />
                              </div>
                            </div>
                          </div>
                        ))
                      ) : getAllSessions(project).length === 0 ? (
                        <div className="py-2 px-3 text-left">
                          <p className="text-xs text-muted-foreground">No conversations yet</p>
                        </div>
                      ) : (
                        <>
                          {/* Delete All Conversations Button - only show if there are conversations */}
                          {(project.sessionMeta?.total > 0 || getAllSessions(project).length > 0) && (
                            <div className="mb-2">
                              {/* Mobile Delete All Button */}
                              <div className="md:hidden px-3">
                                <button
                                  className="w-full h-8 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 rounded-md flex items-center justify-center gap-2 text-xs font-medium active:scale-[0.98] transition-all duration-150 border border-red-200 dark:border-red-800"
                                  onClick={() => deleteAllSessions(project.name)}
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Delete All Conversations ({groupSessionsIntoConversations(getAllSessions(project)).length})
                                </button>
                              </div>
                              
                              {/* Desktop Delete All Button */}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="hidden md:flex w-full justify-center gap-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-xs h-7"
                                onClick={() => deleteAllSessions(project.name)}
                              >
                                <Trash2 className="w-3 h-3" />
                                Delete All Conversations ({groupSessionsIntoConversations(getAllSessions(project)).length})
                              </Button>
                            </div>
                          )}
                          
                          {/* Conversations list */}
                          <div className="overflow-y-auto">
                            {groupSessionsIntoConversations(getAllSessions(project)).map((conversation) => {
                              const isConversationExpanded = expandedConversations.has(conversation.id);
                              
                              return (
                                <div key={conversation.id} className="space-y-1">
                                  {/* Conversation Header */}
                                  <div className="group">
                                    {/* Mobile Conversation Item */}
                                    <div className="md:hidden">
                                      {editingConversation === conversation.id ? (
                                        <div className="p-2 mx-3 my-0.5 rounded-md bg-muted/30 border border-border/40">
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              value={editingConversationName}
                                              onChange={(e) => setEditingConversationName(e.target.value)}
                                              onKeyDown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === 'Enter') {
                                                  saveConversationTitle(project.name, conversation);
                                                } else if (e.key === 'Escape') {
                                                  cancelEditingConversation();
                                                }
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                              className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                              autoFocus
                                            />
                                            <button
                                              className="w-6 h-6 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40 rounded flex items-center justify-center"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                saveConversationTitle(project.name, conversation);
                                              }}
                                              title="Save"
                                            >
                                              <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                                            </button>
                                            <button
                                              className="w-6 h-6 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40 rounded flex items-center justify-center"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                cancelEditingConversation();
                                              }}
                                              title="Cancel"
                                            >
                                              <X className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="group relative">
                                          <div
                                            className="p-2 mx-3 my-0.5 rounded-md bg-muted/30 border border-border/40 active:scale-[0.98] transition-all duration-150"
                                            onClick={() => toggleConversation(conversation.id)}
                                            onTouchEnd={handleTouchClick(() => toggleConversation(conversation.id))}
                                          >
                                            <div className="flex items-center gap-2">
                                              <div className="w-5 h-5 rounded-md bg-muted/50 flex items-center justify-center flex-shrink-0">
                                                {isConversationExpanded ? (
                                                  <ChevronDown className="w-3 h-3 text-muted-foreground" />
                                                ) : (
                                                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                                                )}
                                              </div>
                                              <div className="min-w-0 flex-1">
                                                <div className="text-xs font-medium truncate text-foreground">
                                                  {conversation.title}
                                                </div>
                                                <div className="flex items-center gap-1 mt-0.5">
                                                  <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                                                  <span className="text-xs text-muted-foreground">
                                                    {formatTimeAgo(conversation.lastActivity, currentTime)}
                                                  </span>
                                                </div>
                                              </div>
                                              {/* Mobile conversation action buttons */}
                                              <div className="flex items-center gap-1">
                                                <button
                                                  className="w-6 h-6 rounded-md bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center active:scale-95 transition-transform opacity-70"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    startEditingConversation(conversation);
                                                  }}
                                                  onTouchEnd={handleTouchClick(() => startEditingConversation(conversation))}
                                                  title="Edit conversation"
                                                >
                                                  <Edit2 className="w-2.5 h-2.5 text-blue-600 dark:text-blue-400" />
                                                </button>
                                                <button
                                                  className="w-6 h-6 rounded-md bg-red-50 dark:bg-red-900/20 flex items-center justify-center active:scale-95 transition-transform opacity-70"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteConversation(project.name, conversation);
                                                  }}
                                                  onTouchEnd={handleTouchClick(() => deleteConversation(project.name, conversation))}
                                                  title="Delete conversation"
                                                >
                                                  <Trash2 className="w-2.5 h-2.5 text-red-600 dark:text-red-400" />
                                                </button>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {/* Desktop Conversation Item */}
                                    <div className="hidden md:block group relative">
                                      {editingConversation === conversation.id ? (
                                        <div className="p-2 h-auto bg-accent/50 rounded">
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="text"
                                              value={editingConversationName}
                                              onChange={(e) => setEditingConversationName(e.target.value)}
                                              onKeyDown={(e) => {
                                                e.stopPropagation();
                                                if (e.key === 'Enter') {
                                                  saveConversationTitle(project.name, conversation);
                                                } else if (e.key === 'Escape') {
                                                  cancelEditingConversation();
                                                }
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                              className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                              autoFocus
                                            />
                                            <button
                                              className="w-6 h-6 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40 rounded flex items-center justify-center"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                saveConversationTitle(project.name, conversation);
                                              }}
                                              title="Save"
                                            >
                                              <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                                            </button>
                                            <button
                                              className="w-6 h-6 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40 rounded flex items-center justify-center"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                cancelEditingConversation();
                                              }}
                                              title="Cancel"
                                            >
                                              <X className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <Button
                                          variant="ghost"
                                          className="w-full justify-start p-2 h-auto font-normal text-left hover:bg-accent/50 transition-colors duration-200"
                                          onClick={() => toggleConversation(conversation.id)}
                                          onTouchEnd={handleTouchClick(() => toggleConversation(conversation.id))}
                                        >
                                          <div className="flex items-start gap-2 min-w-0 w-full">
                                            {isConversationExpanded ? (
                                              <ChevronDown className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                                            ) : (
                                              <ChevronRight className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                                            )}
                                            <div className="min-w-0 flex-1">
                                              <div className="text-xs font-medium truncate text-foreground">
                                                {conversation.title}
                                              </div>
                                              <div className="flex items-center gap-1 mt-0.5">
                                                <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                                                <span className="text-xs text-muted-foreground">
                                                  {formatTimeAgo(conversation.lastActivity, currentTime)}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        </Button>
                                      )}
                                      {/* Desktop conversation hover buttons */}
                                      {editingConversation !== conversation.id && (
                                        <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                                          <button
                                            className="w-6 h-6 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 rounded flex items-center justify-center"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startEditingConversation(conversation);
                                            }}
                                            title="Edit conversation"
                                          >
                                            <Edit2 className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                          </button>
                                          <button
                                            className="w-6 h-6 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded flex items-center justify-center"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              deleteConversation(project.name, conversation);
                                            }}
                                            title="Delete conversation"
                                          >
                                            <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Messages within conversation */}
                                  {isConversationExpanded && (
                                    <div className="ml-4 space-y-1 border-l border-border pl-3">
                                      {conversation.sessions.map((session) => {
                          // Calculate if session is active (within last 10 minutes)
                          const sessionDate = new Date(session.lastActivity);
                          const diffInMinutes = Math.floor((currentTime - sessionDate) / (1000 * 60));
                          const isActive = diffInMinutes < 10;
                          
                          return (
                          <div key={session.id} className="group relative">
                            {/* Active session indicator dot */}
                            {isActive && (
                              <div className="absolute left-0 top-1/2 transform -translate-y-1/2 -translate-x-1">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                              </div>
                            )}
                            {/* Mobile Conversation Item */}
                            <div className="md:hidden">
                              <div
                                className={cn(
                                  "p-2 mx-3 my-0.5 rounded-md bg-card border active:scale-[0.98] transition-all duration-150 relative",
                                  selectedSession?.id === session.id ? "bg-primary/5 border-primary/20" :
                                  isActive ? "border-green-500/30 bg-green-50/5 dark:bg-green-900/5" : "border-border/30"
                                )}
                                onClick={() => {
                                  onProjectSelect(project);
                                  if (onConversationSelect) {
                                    onConversationSelect(conversation, session.id);
                                  } else {
                                  onSessionSelect(session);
                                  }
                                }}
                                onTouchEnd={handleTouchClick(() => {
                                  onProjectSelect(project);
                                  if (onConversationSelect) {
                                    onConversationSelect(conversation, session.id);
                                  } else {
                                  onSessionSelect(session);
                                  }
                                })}
                              >
                                <div className="flex items-center gap-2">
                                  <div className={cn(
                                    "w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0",
                                    selectedSession?.id === session.id ? "bg-primary/10" : "bg-muted/50"
                                  )}>
                                    <MessageSquare className={cn(
                                      "w-3 h-3",
                                      selectedSession?.id === session.id ? "text-primary" : "text-muted-foreground"
                                    )} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className={cn(
                                      "text-xs font-medium truncate text-foreground",
                                      session.isPlaceholder && "italic text-muted-foreground"
                                    )}>
                                      {session.isPlaceholder ? '✏️ New Conversation' : (session.summary || 'New Conversation')}
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                                      <span className="text-xs text-muted-foreground">
                                        {formatTimeAgo(session.lastActivity, currentTime)}
                                      </span>
                                    </div>
                                  </div>
                                  {/* Mobile delete button */}
                                  <button
                                    className="w-5 h-5 rounded-md bg-red-50 dark:bg-red-900/20 flex items-center justify-center active:scale-95 transition-transform opacity-70 ml-1"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteSession(project.name, session.id);
                                    }}
                                    onTouchEnd={handleTouchClick(() => deleteSession(project.name, session.id))}
                                  >
                                    <Trash2 className="w-2.5 h-2.5 text-red-600 dark:text-red-400" />
                                  </button>
                                </div>
                              </div>
                            </div>
                            
                            {/* Desktop Conversation Item */}
                            <div className="hidden md:block">
                              <Button
                                variant="ghost"
                                className={cn(
                                  "w-full justify-start p-2 h-auto font-normal text-left hover:bg-accent/50 transition-colors duration-200",
                                  selectedSession?.id === session.id && "bg-accent text-accent-foreground"
                                )}
                                onClick={() => {
                                  if (onConversationSelect) {
                                    onConversationSelect(conversation, session.id);
                                  } else {
                                    onSessionSelect(session);
                                  }
                                }}
                                onTouchEnd={handleTouchClick(() => {
                                  if (onConversationSelect) {
                                    onConversationSelect(conversation, session.id);
                                  } else {
                                    onSessionSelect(session);
                                  }
                                })}
                              >
                                <div className="flex items-start gap-2 min-w-0 w-full">
                                  <MessageSquare className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                                  <div className="min-w-0 flex-1">
                                    <div className={cn(
                                      "text-xs font-medium truncate text-foreground",
                                      session.isPlaceholder && "italic text-muted-foreground"
                                    )}>
                                      {session.isPlaceholder ? '✏️ New Conversation' : (session.summary || 'New Conversation')}
                                    </div>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <Clock className="w-2.5 h-2.5 text-muted-foreground" />
                                      <span className="text-xs text-muted-foreground">
                                        {formatTimeAgo(session.lastActivity, currentTime)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </Button>
                              {/* Desktop hover buttons */}
                              <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-200">
                                {editingSession === session.id ? (
                                  <>
                                    <input
                                      type="text"
                                      value={editingSessionName}
                                      onChange={(e) => setEditingSessionName(e.target.value)}
                                      onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === 'Enter') {
                                          updateSessionSummary(project.name, session.id, editingSessionName);
                                        } else if (e.key === 'Escape') {
                                          setEditingSession(null);
                                          setEditingSessionName('');
                                        }
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-32 px-2 py-1 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                                      autoFocus
                                    />
                                    <button
                                      className="w-6 h-6 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40 rounded flex items-center justify-center"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        updateSessionSummary(project.name, session.id, editingSessionName);
                                      }}
                                      title="Save"
                                    >
                                      <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                                    </button>
                                    <button
                                      className="w-6 h-6 bg-gray-50 hover:bg-gray-100 dark:bg-gray-900/20 dark:hover:bg-gray-900/40 rounded flex items-center justify-center"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditingSession(null);
                                        setEditingSessionName('');
                                      }}
                                      title="Cancel"
                                    >
                                      <X className="w-3 h-3 text-gray-600 dark:text-gray-400" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    {/* Generate summary button */}
                                    {/* <button
                                      className="w-6 h-6 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 rounded flex items-center justify-center"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        generateSessionSummary(project.name, session.id);
                                      }}
                                                                              title="Generate AI summary for this message"
                                      disabled={generatingSummary[`${project.name}-${session.id}`]}
                                    >
                                      {generatingSummary[`${project.name}-${session.id}`] ? (
                                        <div className="w-3 h-3 animate-spin rounded-full border border-blue-600 dark:border-blue-400 border-t-transparent" />
                                      ) : (
                                        <Sparkles className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                      )}
                                    </button> */}

                                    {/* Delete button */}
                                    <button
                                      className="w-6 h-6 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 rounded flex items-center justify-center"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        deleteSession(project.name, session.id);
                                      }}
                                                                              title="Delete this message permanently"
                                    >
                                      <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                          );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                      
                      {/* New Conversation Button */}
                      <div className="md:hidden px-3 pb-2">
                        <button
                          className="w-full h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center gap-2 font-medium text-xs active:scale-[0.98] transition-all duration-150"
                          onClick={() => {
                            onProjectSelect(project);
                            onNewSession(project);
                          }}
                        >
                          <Plus className="w-3 h-3" />
                          New Conversation
                        </button>
                      </div>
                      
                      <Button
                        variant="default"
                        size="sm"
                        className="hidden md:flex w-full justify-start gap-2 mt-1 h-8 text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
                        onClick={() => onNewSession(project)}
                      >
                        <Plus className="w-3 h-3" />
                        New Conversation
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
      
      {/* Version Update Notification */}
      {updateAvailable && (
        <div className="md:p-2 border-t border-border/50 flex-shrink-0">
          {/* Desktop Version Notification */}
          <div className="hidden md:block">
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 p-3 h-auto font-normal text-left hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors duration-200 border border-blue-200 dark:border-blue-700 rounded-lg mb-2"
              onClick={onShowVersionModal}
            >
              <div className="relative">
                <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-blue-700 dark:text-blue-300">Update Available</div>
                <div className="text-xs text-blue-600 dark:text-blue-400">Version {latestVersion} is ready</div>
              </div>
            </Button>
          </div>
          
          {/* Mobile Version Notification */}
          <div className="md:hidden p-3 pb-2">
            <button
              className="w-full h-12 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl flex items-center justify-start gap-3 px-4 active:scale-[0.98] transition-all duration-150"
              onClick={onShowVersionModal}
            >
              <div className="relative">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              </div>
              <div className="min-w-0 flex-1 text-left">
                <div className="text-sm font-medium text-blue-700 dark:text-blue-300">Update Available</div>
                <div className="text-xs text-blue-600 dark:text-blue-400">Version {latestVersion} is ready</div>
              </div>
            </button>
          </div>
        </div>
      )}
      
      {/* Settings Section */}
      <div className="md:p-2 md:border-t md:border-border flex-shrink-0">
        {/* Mobile Settings */}
        <div className="md:hidden p-4 pb-20 border-t border-border/50">
          <button
            className="w-full h-14 bg-muted/50 hover:bg-muted/70 rounded-2xl flex items-center justify-start gap-4 px-4 active:scale-[0.98] transition-all duration-150"
            onClick={onShowSettings}
          >
            <div className="w-10 h-10 rounded-2xl bg-background/80 flex items-center justify-center">
              <Settings className="w-5 h-5 text-muted-foreground" />
            </div>
            <span className="text-lg font-medium text-foreground">Settings</span>
          </button>
        </div>
        
        {/* Desktop Settings */}
        <Button
          variant="ghost"
          className="hidden md:flex w-full justify-start gap-2 p-2 h-auto font-normal text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-200"
          onClick={onShowSettings}
        >
          <Settings className="w-3 h-3" />
          <span className="text-xs">Tools Settings</span>
        </Button>
      </div>
    </div>
  );
}

export default Sidebar;