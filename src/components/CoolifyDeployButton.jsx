import React, { useState } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  Cloud,
  Rocket,
  Loader2,
  CheckCircle2,
  XCircle,
  GitBranch,
  AlertTriangle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { api } from '../utils/api';

function CoolifyDeployButton({
  coolifyApp,
  projectPath,
  gitStatus,
  className
}) {
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployResult, setDeployResult] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  if (!coolifyApp) {
    return null;
  }

  const hasChanges = gitStatus?.hasUncommittedChanges ||
                     gitStatus?.uncommittedCount > 0 ||
                     gitStatus?.stagedCount > 0;

  const hasUnpushedCommits = gitStatus?.ahead > 0;

  const handleDeploy = async () => {
    if (!showConfirm) {
      setShowConfirm(true);
      return;
    }

    setShowConfirm(false);
    setIsDeploying(true);
    setDeployResult(null);

    try {
      const response = await api.coolify.deploy(
        coolifyApp.uuid,
        projectPath,
        `Deploy via Claude Code UI`
      );

      const result = await response.json();

      if (result.success) {
        setDeployResult({
          success: true,
          message: `Pushed to ${result.branch}`,
          commit: result.commit?.hash?.slice(0, 7)
        });
      } else {
        setDeployResult({
          success: false,
          message: result.error || 'Deploy failed'
        });
      }
    } catch (err) {
      setDeployResult({
        success: false,
        message: err.message
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const cancelConfirm = (e) => {
    e.stopPropagation();
    setShowConfirm(false);
  };

  // Clear deploy result after 5 seconds
  React.useEffect(() => {
    if (deployResult) {
      const timer = setTimeout(() => setDeployResult(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [deployResult]);

  return (
    <div className={cn("space-y-2", className)}>
      {/* Deploy Info */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Cloud className="w-3.5 h-3.5" />
        <span className="truncate">{coolifyApp.name}</span>
        <GitBranch className="w-3 h-3 ml-auto" />
        <span>{coolifyApp.git_branch || 'main'}</span>
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-2 flex-wrap">
        {hasChanges && (
          <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/30">
            {gitStatus?.uncommittedCount || 0} uncommitted
          </Badge>
        )}
        {hasUnpushedCommits && (
          <Badge variant="outline" className="text-xs text-blue-500 border-blue-500/30">
            {gitStatus?.ahead} ahead
          </Badge>
        )}
        {!hasChanges && !hasUnpushedCommits && (
          <Badge variant="outline" className="text-xs text-green-500 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Up to date
          </Badge>
        )}
      </div>

      {/* Deploy Button */}
      {showConfirm ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="destructive"
            className="flex-1"
            onClick={handleDeploy}
          >
            <AlertTriangle className="w-4 h-4 mr-1" />
            Confirm Deploy
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={cancelConfirm}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          className="w-full"
          onClick={handleDeploy}
          disabled={isDeploying || (!hasChanges && !hasUnpushedCommits)}
        >
          {isDeploying ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Deploying...
            </>
          ) : (
            <>
              <Rocket className="w-4 h-4 mr-2" />
              Deploy to Coolify
            </>
          )}
        </Button>
      )}

      {/* Deploy Result */}
      {deployResult && (
        <div className={cn(
          "flex items-center gap-2 text-xs p-2 rounded-md",
          deployResult.success
            ? "bg-green-500/10 text-green-500"
            : "bg-red-500/10 text-red-500"
        )}>
          {deployResult.success ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0" />
          )}
          <span className="truncate">
            {deployResult.message}
            {deployResult.commit && ` (${deployResult.commit})`}
          </span>
        </div>
      )}
    </div>
  );
}

export default CoolifyDeployButton;
