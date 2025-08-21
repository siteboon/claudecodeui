import * as React from "react"
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
  Edit3,
  Check,
  X,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { api } from "@/utils/api"

const formatTimeAgo = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  
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

export function AppSidebar({
  projects = [],
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onProjectDelete,
  isLoading,
  onRefresh,
  onShowSettings,
  updateAvailable,
  currentVersion,
  onShowVersionModal,
}) {
  const [expandedProjects, setExpandedProjects] = React.useState(new Set());
  const [searchFilter, setSearchFilter] = React.useState('');
  const [starredProjects, setStarredProjects] = React.useState(() => {
    try {
      const saved = localStorage.getItem('starredProjects');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch (error) {
      console.error('Error loading starred projects:', error);
      return new Set();
    }
  });
  const [showNewProject, setShowNewProject] = React.useState(false);
  const [newProjectPath, setNewProjectPath] = React.useState('');
  const [creatingProject, setCreatingProject] = React.useState(false);
  const [editingProject, setEditingProject] = React.useState(null);
  const [editingName, setEditingName] = React.useState('');

  React.useEffect(() => {
    localStorage.setItem('starredProjects', JSON.stringify(Array.from(starredProjects)));
  }, [starredProjects]);

  const toggleProjectExpanded = (projectName) => {
    setExpandedProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectName)) {
        newSet.delete(projectName);
      } else {
        newSet.add(projectName);
      }
      return newSet;
    });
  };

  const toggleStarred = (projectName) => {
    setStarredProjects(prev => {
      const newSet = new Set(prev);
      if (newSet.has(projectName)) {
        newSet.delete(projectName);
      } else {
        newSet.add(projectName);
      }
      return newSet;
    });
  };

  const handleCreateProject = async () => {
    if (!newProjectPath.trim()) return;
    
    setCreatingProject(true);
    try {
      const response = await api.createProject(newProjectPath);
      if (response.success) {
        setShowNewProject(false);
        setNewProjectPath('');
        onRefresh();
      }
    } catch (error) {
      console.error('Error creating project:', error);
    } finally {
      setCreatingProject(false);
    }
  };

  const startEditingProject = (project) => {
    setEditingProject(project.name);
    setEditingName(project.displayName || project.name);
  };

  const cancelEditingProject = () => {
    setEditingProject(null);
    setEditingName('');
  };

  const saveProjectName = async (projectName) => {
    try {
      const response = await api.renameProject(projectName, editingName);
      if (response.ok) {
        onRefresh();
      } else {
        console.error('Failed to rename project');
      }
    } catch (error) {
      console.error('Error renaming project:', error);
    }
    setEditingProject(null);
    setEditingName('');
  };

  const filteredProjects = projects.filter(project => {
    const searchLower = searchFilter.toLowerCase();
    const displayName = (project.displayName || project.name).toLowerCase();
    const projectName = project.name.toLowerCase();
    
    return displayName.includes(searchLower) || 
           projectName.includes(searchLower) ||
           project.sessions?.some(session => 
             (session.summary || session.title || session.name || '').toLowerCase().includes(searchLower)
           );
  });

  const sortedProjects = [...filteredProjects].sort((a, b) => {
    const aStarred = starredProjects.has(a.name);
    const bStarred = starredProjects.has(b.name);
    
    if (aStarred && !bStarred) return -1;
    if (!aStarred && bStarred) return 1;
    
    return a.name.localeCompare(b.name);
  });

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="border-b">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/" className="flex items-center gap-2">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <span className="text-lg font-bold">C</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">Claude Code UI</span>
                  <span className="text-xs text-muted-foreground">v{currentVersion}</span>
                </div>
              </a>
            </SidebarMenuButton>
            {updateAvailable && (
              <SidebarMenuAction onClick={onShowVersionModal} showOnHover>
                <Badge variant="secondary" className="text-xs">
                  Update
                </Badge>
              </SidebarMenuAction>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      
      <SidebarContent>
        <div className="px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-8 h-8"
            />
          </div>
        </div>

        <SidebarGroup className="flex-1">
          <SidebarGroupLabel className="flex items-center justify-between px-3">
            <span>Projects</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setShowNewProject(!showNewProject)}
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={cn(
                  "h-3.5 w-3.5",
                  isLoading && "animate-spin"
                )} />
              </Button>
            </div>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <ScrollArea className="h-[calc(100vh-260px)]">
              <SidebarMenu>
              
              {showNewProject && (
                <SidebarMenuItem>
                  <div className="flex items-center gap-1 px-2">
                    <Input
                      placeholder="Project path..."
                      value={newProjectPath}
                      onChange={(e) => setNewProjectPath(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleCreateProject()}
                      className="h-8"
                      autoFocus
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0"
                      onClick={handleCreateProject}
                      disabled={creatingProject}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </SidebarMenuItem>
              )}
              {sortedProjects.map((project) => {
              const isExpanded = expandedProjects.has(project.name);
              const isStarred = starredProjects.has(project.name);
              const isSelected = selectedProject?.name === project.name;

              return (
                <SidebarMenuItem key={project.name}>
                  <SidebarMenuButton
                    onClick={() => {
                      toggleProjectExpanded(project.name);
                      onProjectSelect(project);
                    }}
                    tooltip={project.name}
                    isActive={isSelected}
                    className="group/item"
                  >
                    {isExpanded ? (
                      <FolderOpen className="h-4 w-4 shrink-0" />
                    ) : (
                      <Folder className="h-4 w-4 shrink-0" />
                    )}
                    <span className="flex-1 min-w-0">
                      {editingProject === project.name ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                saveProjectName(project.name);
                              } else if (e.key === 'Escape') {
                                cancelEditingProject();
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="h-6 px-2 text-sm"
                            autoFocus
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              saveProjectName(project.name);
                            }}
                          >
                            <Check className="h-3 w-3 text-green-600" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEditingProject();
                            }}
                          >
                            <X className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      ) : (
                        <span className="block truncate font-medium" title={project.fullPath || project.path}>
                          {project.displayName || project.name}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {isStarred && (
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                      )}
                      <ChevronRight className={cn(
                        "h-4 w-4 transition-transform",
                        isExpanded && "rotate-90"
                      )} />
                    </div>
                  </SidebarMenuButton>
                    
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuAction 
                        showOnHover 
                        className="opacity-0 group-hover/item:opacity-100 data-[state=open]:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">More</span>
                      </SidebarMenuAction>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      className="w-48 rounded-lg"
                      side="right"
                      align="start"
                    >
                      <DropdownMenuItem onClick={() => onNewSession(project)}>
                        <Plus className="mr-2 h-4 w-4" />
                        <span>New Session</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => startEditingProject(project)}>
                        <Edit3 className="mr-2 h-4 w-4" />
                        <span>Rename Project</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleStarred(project.name)}>
                        <Star className={cn(
                          "mr-2 h-4 w-4",
                          isStarred && "fill-current text-yellow-500"
                        )} />
                        <span>{isStarred ? 'Unstar' : 'Star'}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={() => onProjectDelete(project.name)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        <span>Delete Project</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                    
                  {isExpanded && project.sessions && (
                    <SidebarMenuSub>
                      {project.sessions.map((session) => {
                        const isSessionSelected = selectedSession?.id === session.id;
                        
                        return (
                          <SidebarMenuSubItem key={session.id}>
                            <SidebarMenuSubButton
                              onClick={() => onSessionSelect(project, session)}
                              isActive={isSessionSelected}
                              className="pl-4 group/session"
                              tooltip={session.summary || session.title || session.name || 'Untitled Session'}
                            >
                              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                              <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                                <span className="truncate text-sm">
                                  {session.summary || session.title || session.name || 'Untitled Session'}
                                </span>
                                <span className="text-xs text-muted-foreground shrink-0 opacity-0 group-hover/session:opacity-100 transition-opacity">
                                  {formatTimeAgo(session.updated_at)}
                                </span>
                              </div>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              );
            })}
            
              {sortedProjects.length === 0 && !isLoading && (
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No projects found.
                  <br />
                  Click "New Project" to add one.
                </div>
              )}
            </SidebarMenu>
            </ScrollArea>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onShowSettings}>
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}