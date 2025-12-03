import React, { useState, useEffect } from 'react';
import { ScrollArea } from './ui/scroll-area';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Server,
  GitBranch,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  FolderGit2,
  AlertCircle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { api } from '../utils/api';

function CoolifySidebar({
  onProjectSelect,
  onRefresh,
  localProjects = []
}) {
  const [hierarchy, setHierarchy] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [coolifyStatus, setCoolifyStatus] = useState(null);
  const [expandedProjects, setExpandedProjects] = useState(new Set());
  const [expandedEnvironments, setExpandedEnvironments] = useState(new Set());
  const [cloningApp, setCloningApp] = useState(null);
  const [cloneError, setCloneError] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Check Coolify connection status
  useEffect(() => {
    checkCoolifyStatus();
  }, []);

  // Fetch hierarchy when connected
  useEffect(() => {
    if (coolifyStatus?.connected) {
      fetchHierarchy();
    }
  }, [coolifyStatus?.connected]);

  const checkCoolifyStatus = async () => {
    try {
      const response = await api.coolify.status();
      const data = await response.json();
      setCoolifyStatus(data);
      if (!data.connected) {
        setIsLoading(false);
        setError(data.error || 'Not connected to Coolify');
      }
    } catch (err) {
      setCoolifyStatus({ connected: false, error: err.message });
      setIsLoading(false);
      setError(err.message);
    }
  };

  const fetchHierarchy = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.coolify.getHierarchy();
      const data = await response.json();
      // Ensure we always have an array
      if (Array.isArray(data)) {
        setHierarchy(data);
      } else if (data?.error) {
        setError(data.error);
        setHierarchy([]);
      } else {
        setHierarchy([]);
      }
    } catch (err) {
      setError(err.message);
      setHierarchy([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await checkCoolifyStatus();
    if (coolifyStatus?.connected) {
      await fetchHierarchy();
    }
    setIsRefreshing(false);
    onRefresh?.();
  };

  const toggleProject = (projectId) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const toggleEnvironment = (envId) => {
    setExpandedEnvironments(prev => {
      const next = new Set(prev);
      if (next.has(envId)) {
        next.delete(envId);
      } else {
        next.add(envId);
      }
      return next;
    });
  };

  // Check if an app is locally cloned by matching git remote URL
  const isAppClonedLocally = (app) => {
    if (!app.git_repository || !localProjects) return false;

    // Normalize git URLs for comparison
    const normalizeUrl = (url) => {
      if (!url) return '';
      return url
        .replace(/\.git$/, '')
        .replace(/^git@github\.com:/, 'https://github.com/')
        .replace(/^git@gitlab\.com:/, 'https://gitlab.com/')
        .toLowerCase();
    };

    const appUrl = normalizeUrl(app.git_repository);

    return localProjects.some(project => {
      const projectUrl = normalizeUrl(project.gitRemoteUrl);
      return projectUrl === appUrl && project.gitBranch === app.git_branch;
    });
  };

  const handleAppClick = async (app) => {
    if (cloningApp) return; // Prevent multiple clicks while cloning

    // Clear any previous errors
    setCloneError(null);
    setCloningApp(app.uuid);

    try {
      const response = await api.coolify.clone(app.uuid);
      const result = await response.json();

      if (result.success) {
        // Notify parent to refresh projects and select the new one
        onProjectSelect?.(result.path, app);
        onRefresh?.();
      } else {
        const errorMsg = result.error || 'Clone failed';
        console.error('Clone failed:', errorMsg);
        setCloneError({ appUuid: app.uuid, message: errorMsg });
      }
    } catch (err) {
      console.error('Clone error:', err);
      let errorMsg = err.message;

      // Provide helpful error messages
      if (errorMsg.includes('Authentication failed') || errorMsg.includes('could not read Username')) {
        errorMsg = 'Git authentication required. Please configure SSH keys or git credentials.';
      } else if (errorMsg.includes('Permission denied')) {
        errorMsg = 'Permission denied. Check your SSH keys or git credentials.';
      } else if (errorMsg.includes('Repository not found')) {
        errorMsg = 'Repository not found. Check if you have access to this repo.';
      }

      setCloneError({ appUuid: app.uuid, message: errorMsg });
    } finally {
      setCloningApp(null);
    }
  };

  // Clear error after 10 seconds
  useEffect(() => {
    if (cloneError) {
      const timer = setTimeout(() => setCloneError(null), 10000);
      return () => clearTimeout(timer);
    }
  }, [cloneError]);

  const getStatusBadge = (status) => {
    const statusLower = (status || '').toLowerCase();

    if (statusLower.includes('running') || statusLower.includes('healthy')) {
      return (
        <Badge variant="outline" className="text-green-500 border-green-500/30 text-xs px-1.5 py-0">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Running
        </Badge>
      );
    }

    if (statusLower.includes('stopped') || statusLower.includes('exited')) {
      return (
        <Badge variant="outline" className="text-gray-500 border-gray-500/30 text-xs px-1.5 py-0">
          <XCircle className="w-3 h-3 mr-1" />
          Stopped
        </Badge>
      );
    }

    if (statusLower.includes('deploying') || statusLower.includes('building')) {
      return (
        <Badge variant="outline" className="text-yellow-500 border-yellow-500/30 text-xs px-1.5 py-0">
          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          Deploying
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="text-gray-400 border-gray-400/30 text-xs px-1.5 py-0">
        {status || 'Unknown'}
      </Badge>
    );
  };

  // Render not connected state
  if (!coolifyStatus?.connected) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Coolify</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center space-y-2">
            <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">
              {error || 'Not connected to Coolify'}
            </p>
            <p className="text-xs text-muted-foreground">
              Set COOLIFY_URL and COOLIFY_TOKEN environment variables
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render loading state
  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Coolify</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cloud className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium">Coolify</span>
          <Badge variant="outline" className="text-xs px-1.5 py-0 text-green-500 border-green-500/30">
            Connected
          </Badge>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
        </Button>
      </div>

      {/* Projects List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {hierarchy.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No projects found
            </div>
          ) : (
            hierarchy.map(project => (
              <div key={project.id} className="space-y-0.5">
                {/* Project Header */}
                <button
                  onClick={() => toggleProject(project.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-left group"
                >
                  {expandedProjects.has(project.id) ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <FolderGit2 className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-sm font-medium truncate flex-1">
                    {project.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {project.environments?.length || 0} env
                  </span>
                </button>

                {/* Environments */}
                {expandedProjects.has(project.id) && project.environments?.map(env => (
                  <div key={env.id} className="ml-4 space-y-0.5">
                    {/* Environment Header */}
                    <button
                      onClick={() => toggleEnvironment(env.id)}
                      className="w-full flex items-center gap-2 px-2 py-1 rounded-md hover:bg-accent text-left"
                    >
                      {expandedEnvironments.has(env.id) ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                      <Server className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm text-muted-foreground truncate flex-1">
                        {env.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {env.applications?.length || 0}
                      </span>
                    </button>

                    {/* Applications */}
                    {expandedEnvironments.has(env.id) && env.applications?.map(app => {
                      const isCloned = isAppClonedLocally(app);
                      const isCloning = cloningApp === app.uuid;
                      const hasError = cloneError?.appUuid === app.uuid;

                      return (
                        <div
                          key={app.uuid}
                          className={cn(
                            "ml-4 px-2 py-1.5 rounded-md cursor-pointer group",
                            "hover:bg-accent border border-transparent",
                            isCloned && "border-primary/20 bg-primary/5",
                            hasError && "border-red-500/30 bg-red-500/5"
                          )}
                          onClick={() => handleAppClick(app)}
                        >
                          <div className="flex items-center gap-2">
                            {isCloning ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                            ) : hasError ? (
                              <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                            ) : isCloned ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                            ) : (
                              <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground shrink-0" />
                            )}
                            <span className={cn(
                              "text-sm truncate flex-1",
                              isCloned && "text-primary",
                              hasError && "text-red-500"
                            )}>
                              {app.name}
                            </span>
                            {getStatusBadge(app.status)}
                          </div>

                          {/* App Details */}
                          <div className="flex items-center gap-2 mt-1 ml-5">
                            <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="text-xs text-muted-foreground truncate">
                              {app.git_branch || 'main'}
                            </span>
                            {app.fqdn && (
                              <a
                                href={app.fqdn.startsWith('http') ? app.fqdn : `https://${app.fqdn}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-muted-foreground hover:text-primary"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>

                          {/* Error message */}
                          {hasError && (
                            <div className="mt-2 ml-5 p-2 rounded bg-red-500/10 border border-red-500/20">
                              <p className="text-xs text-red-500">
                                {cloneError.message}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Tip: Configure SSH keys or use <code className="bg-muted px-1 rounded">git config</code> for HTTPS credentials
                              </p>
                            </div>
                          )}

                          {/* Cloning status message */}
                          {isCloning && (
                            <div className="mt-2 ml-5 text-xs text-muted-foreground">
                              Cloning repository...
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default CoolifySidebar;
