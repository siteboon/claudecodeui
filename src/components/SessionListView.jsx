import React from "react";
import { Clock, Trash2, MessageSquare, Folder } from "lucide-react";
import { cn } from "../lib/utils";
import { Badge } from "./ui/badge";
import ClaudeLogo from "./ClaudeLogo";
import CursorLogo from "./CursorLogo.jsx";
import CodexLogo from "./CodexLogo.jsx";

// Format time ago helper
const formatTimeAgo = (dateString, currentTime) => {
  const date = new Date(dateString);
  const now = currentTime;

  if (isNaN(date.getTime())) {
    return "Unknown";
  }

  const diffInMs = now - date;
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInMinutes < 1) return "Just now";
  if (diffInMinutes === 1) return "1 min ago";
  if (diffInMinutes < 60) return `${diffInMinutes} mins ago`;
  if (diffInHours === 1) return "1 hour ago";
  if (diffInHours < 24) return `${diffInHours} hours ago`;
  if (diffInDays === 1) return "1 day ago";
  if (diffInDays < 7) return `${diffInDays} days ago`;
  return date.toLocaleDateString();
};

function SessionListView({
  sessions,
  selectedSession,
  onSessionSelect,
  onSessionDelete,
  isLoading,
  currentTime,
  isMobile = false,
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="p-3 rounded-md bg-muted/30 animate-pulse">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-muted rounded-md" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4">
          <MessageSquare className="w-6 h-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-medium text-foreground mb-2">
          No sessions found
        </h3>
        <p className="text-sm text-muted-foreground">
          No sessions match the selected timeframe
        </p>
      </div>
    );
  }

  const handleSessionClick = (session) => {
    // Attach project info to the session for navigation
    onSessionSelect({
      ...session,
      __projectName: session.project?.name,
      __provider: session.provider,
    });
  };

  const handleDelete = (e, session) => {
    e.stopPropagation();
    if (
      !confirm(
        "Are you sure you want to delete this session? This action cannot be undone.",
      )
    ) {
      return;
    }
    onSessionDelete(session.project?.name, session.id, session.provider);
  };

  const ProviderIcon = ({ provider, className }) => {
    switch (provider) {
      case "cursor":
        return <CursorLogo className={className} />;
      case "codex":
        return <CodexLogo className={className} />;
      default:
        return <ClaudeLogo className={className} />;
    }
  };

  return (
    <div className="space-y-1 p-2">
      {sessions.map((session) => {
        const isSelected = selectedSession?.id === session.id;
        const sessionTime = new Date(session.lastActivity);
        const diffInMinutes = Math.floor(
          (currentTime - sessionTime) / (1000 * 60),
        );
        const isActive = diffInMinutes < 10;

        return (
          <div
            key={session.id}
            className={cn(
              "group relative p-3 rounded-md cursor-pointer transition-all duration-150",
              "hover:bg-accent/50",
              isSelected && "bg-accent",
              isActive && !isSelected && "border-l-2 border-green-500",
            )}
            onClick={() => handleSessionClick(session)}
          >
            <div className="flex items-start gap-3">
              {/* Provider icon */}
              <div
                className={cn(
                  "w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0",
                  isSelected ? "bg-primary/10" : "bg-muted/50",
                )}
              >
                <ProviderIcon provider={session.provider} className="w-4 h-4" />
              </div>

              {/* Session info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-sm font-medium truncate",
                      isSelected ? "text-accent-foreground" : "text-foreground",
                    )}
                  >
                    {session.summary || "New Session"}
                  </span>
                  {isActive && (
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse flex-shrink-0" />
                  )}
                </div>

                {/* Project info */}
                <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
                  <Folder className="w-3 h-3" />
                  <span className="truncate">
                    {session.project?.displayName || "Unknown Project"}
                  </span>
                </div>

                {/* Time and message count */}
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>
                      {formatTimeAgo(session.lastActivity, currentTime)}
                    </span>
                  </div>
                  {session.messageCount > 0 && (
                    <Badge variant="secondary" className="text-xs px-1 py-0">
                      {session.messageCount}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Delete button (hidden on cursor sessions, always hidden on mobile for now) */}
              {session.provider !== "cursor" && !isMobile && (
                <button
                  className={cn(
                    "w-6 h-6 rounded flex items-center justify-center",
                    "opacity-0 group-hover:opacity-100 transition-opacity",
                    "hover:bg-red-50 dark:hover:bg-red-900/20",
                  )}
                  onClick={(e) => handleDelete(e, session)}
                  title="Delete session"
                >
                  <Trash2 className="w-3 h-3 text-red-600 dark:text-red-400" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SessionListView;
