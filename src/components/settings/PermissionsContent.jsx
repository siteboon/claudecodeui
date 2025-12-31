import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Shield, AlertTriangle, Plus, X } from 'lucide-react';

// Common tool patterns for Claude
const commonClaudeTools = [
  'Bash(git log:*)',
  'Bash(git diff:*)',
  'Bash(git status:*)',
  'Write',
  'Read',
  'Edit',
  'Glob',
  'Grep',
  'MultiEdit',
  'Task',
  'TodoWrite',
  'TodoRead',
  'WebFetch',
  'WebSearch'
];

// Common shell commands for Cursor
const commonCursorCommands = [
  'Shell(ls)',
  'Shell(mkdir)',
  'Shell(cd)',
  'Shell(cat)',
  'Shell(echo)',
  'Shell(git status)',
  'Shell(git diff)',
  'Shell(git log)',
  'Shell(npm install)',
  'Shell(npm run)',
  'Shell(python)',
  'Shell(node)'
];

// Claude Permissions
function ClaudePermissions({
  skipPermissions,
  setSkipPermissions,
  allowedTools,
  setAllowedTools,
  disallowedTools,
  setDisallowedTools,
  newAllowedTool,
  setNewAllowedTool,
  newDisallowedTool,
  setNewDisallowedTool,
}) {
  const addAllowedTool = (tool) => {
    if (tool && !allowedTools.includes(tool)) {
      setAllowedTools([...allowedTools, tool]);
      setNewAllowedTool('');
    }
  };

  const removeAllowedTool = (tool) => {
    setAllowedTools(allowedTools.filter(t => t !== tool));
  };

  const addDisallowedTool = (tool) => {
    if (tool && !disallowedTools.includes(tool)) {
      setDisallowedTools([...disallowedTools, tool]);
      setNewDisallowedTool('');
    }
  };

  const removeDisallowedTool = (tool) => {
    setDisallowedTools(disallowedTools.filter(t => t !== tool));
  };

  return (
    <div className="space-y-6">
      {/* Skip Permissions */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <h3 className="text-lg font-medium text-foreground">
            Permission Settings
          </h3>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
            />
            <div>
              <div className="font-medium text-orange-900 dark:text-orange-100">
                Skip permission prompts (use with caution)
              </div>
              <div className="text-sm text-orange-700 dark:text-orange-300">
                Equivalent to --dangerously-skip-permissions flag
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Allowed Tools */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">
            Allowed Tools
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Tools that are automatically allowed without prompting for permission
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newAllowedTool}
            onChange={(e) => setNewAllowedTool(e.target.value)}
            placeholder='e.g., "Bash(git log:*)" or "Write"'
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAllowedTool(newAllowedTool);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => addAllowedTool(newAllowedTool)}
            disabled={!newAllowedTool}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">Add</span>
          </Button>
        </div>

        {/* Quick add buttons */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Quick add common tools:
          </p>
          <div className="flex flex-wrap gap-2">
            {commonClaudeTools.map(tool => (
              <Button
                key={tool}
                variant="outline"
                size="sm"
                onClick={() => addAllowedTool(tool)}
                disabled={allowedTools.includes(tool)}
                className="text-xs h-8"
              >
                {tool}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {allowedTools.map(tool => (
            <div key={tool} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <span className="font-mono text-sm text-green-800 dark:text-green-200">
                {tool}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeAllowedTool(tool)}
                className="text-green-600 hover:text-green-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {allowedTools.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              No allowed tools configured
            </div>
          )}
        </div>
      </div>

      {/* Disallowed Tools */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <h3 className="text-lg font-medium text-foreground">
            Blocked Tools
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Tools that are automatically blocked without prompting for permission
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newDisallowedTool}
            onChange={(e) => setNewDisallowedTool(e.target.value)}
            placeholder='e.g., "Bash(rm:*)"'
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDisallowedTool(newDisallowedTool);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => addDisallowedTool(newDisallowedTool)}
            disabled={!newDisallowedTool}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">Add</span>
          </Button>
        </div>

        <div className="space-y-2">
          {disallowedTools.map(tool => (
            <div key={tool} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <span className="font-mono text-sm text-red-800 dark:text-red-200">
                {tool}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeDisallowedTool(tool)}
                className="text-red-600 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {disallowedTools.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              No blocked tools configured
            </div>
          )}
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
          Tool Pattern Examples:
        </h4>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git log:*)"</code> - Allow all git log commands</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git diff:*)"</code> - Allow all git diff commands</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Write"</code> - Allow all Write tool usage</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(rm:*)"</code> - Block all rm commands (dangerous)</li>
        </ul>
      </div>
    </div>
  );
}

// Cursor Permissions
function CursorPermissions({
  skipPermissions,
  setSkipPermissions,
  allowedCommands,
  setAllowedCommands,
  disallowedCommands,
  setDisallowedCommands,
  newAllowedCommand,
  setNewAllowedCommand,
  newDisallowedCommand,
  setNewDisallowedCommand,
}) {
  const addAllowedCommand = (cmd) => {
    if (cmd && !allowedCommands.includes(cmd)) {
      setAllowedCommands([...allowedCommands, cmd]);
      setNewAllowedCommand('');
    }
  };

  const removeAllowedCommand = (cmd) => {
    setAllowedCommands(allowedCommands.filter(c => c !== cmd));
  };

  const addDisallowedCommand = (cmd) => {
    if (cmd && !disallowedCommands.includes(cmd)) {
      setDisallowedCommands([...disallowedCommands, cmd]);
      setNewDisallowedCommand('');
    }
  };

  const removeDisallowedCommand = (cmd) => {
    setDisallowedCommands(disallowedCommands.filter(c => c !== cmd));
  };

  return (
    <div className="space-y-6">
      {/* Skip Permissions */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <h3 className="text-lg font-medium text-foreground">
            Permission Settings
          </h3>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
              className="w-4 h-4 text-purple-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-purple-500 focus:ring-2"
            />
            <div>
              <div className="font-medium text-orange-900 dark:text-orange-100">
                Skip permission prompts (use with caution)
              </div>
              <div className="text-sm text-orange-700 dark:text-orange-300">
                Equivalent to -f flag in Cursor CLI
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Allowed Commands */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">
            Allowed Shell Commands
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Shell commands that are automatically allowed without prompting
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newAllowedCommand}
            onChange={(e) => setNewAllowedCommand(e.target.value)}
            placeholder='e.g., "Shell(ls)" or "Shell(git status)"'
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addAllowedCommand(newAllowedCommand);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => addAllowedCommand(newAllowedCommand)}
            disabled={!newAllowedCommand}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">Add</span>
          </Button>
        </div>

        {/* Quick add buttons */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Quick add common commands:
          </p>
          <div className="flex flex-wrap gap-2">
            {commonCursorCommands.map(cmd => (
              <Button
                key={cmd}
                variant="outline"
                size="sm"
                onClick={() => addAllowedCommand(cmd)}
                disabled={allowedCommands.includes(cmd)}
                className="text-xs h-8"
              >
                {cmd}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {allowedCommands.map(cmd => (
            <div key={cmd} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <span className="font-mono text-sm text-green-800 dark:text-green-200">
                {cmd}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeAllowedCommand(cmd)}
                className="text-green-600 hover:text-green-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {allowedCommands.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              No allowed commands configured
            </div>
          )}
        </div>
      </div>

      {/* Disallowed Commands */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <h3 className="text-lg font-medium text-foreground">
            Blocked Shell Commands
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Shell commands that are automatically blocked
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newDisallowedCommand}
            onChange={(e) => setNewDisallowedCommand(e.target.value)}
            placeholder='e.g., "Shell(rm -rf)" or "Shell(sudo)"'
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDisallowedCommand(newDisallowedCommand);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => addDisallowedCommand(newDisallowedCommand)}
            disabled={!newDisallowedCommand}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">Add</span>
          </Button>
        </div>

        <div className="space-y-2">
          {disallowedCommands.map(cmd => (
            <div key={cmd} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <span className="font-mono text-sm text-red-800 dark:text-red-200">
                {cmd}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeDisallowedCommand(cmd)}
                className="text-red-600 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {disallowedCommands.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              No blocked commands configured
            </div>
          )}
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
        <h4 className="font-medium text-purple-900 dark:text-purple-100 mb-2">
          Shell Command Examples:
        </h4>
        <ul className="text-sm text-purple-800 dark:text-purple-200 space-y-1">
          <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(ls)"</code> - Allow ls command</li>
          <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(git status)"</code> - Allow git status</li>
          <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(npm install)"</code> - Allow npm install</li>
          <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(rm -rf)"</code> - Block recursive delete</li>
        </ul>
      </div>
    </div>
  );
}

// Codex Permissions
function CodexPermissions({ permissionMode, setPermissionMode }) {
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">
            Permission Mode
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Controls how Codex handles file modifications and command execution
        </p>

        {/* Default Mode */}
        <div
          className={`border rounded-lg p-4 cursor-pointer transition-all ${
            permissionMode === 'default'
              ? 'bg-gray-100 dark:bg-gray-800 border-gray-400 dark:border-gray-500'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          onClick={() => setPermissionMode('default')}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'default'}
              onChange={() => setPermissionMode('default')}
              className="mt-1 w-4 h-4 text-green-600"
            />
            <div>
              <div className="font-medium text-foreground">Default</div>
              <div className="text-sm text-muted-foreground">
                Only trusted commands (ls, cat, grep, git status, etc.) run automatically.
                Other commands are skipped. Can write to workspace.
              </div>
            </div>
          </label>
        </div>

        {/* Accept Edits Mode */}
        <div
          className={`border rounded-lg p-4 cursor-pointer transition-all ${
            permissionMode === 'acceptEdits'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-400 dark:border-green-600'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          onClick={() => setPermissionMode('acceptEdits')}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'acceptEdits'}
              onChange={() => setPermissionMode('acceptEdits')}
              className="mt-1 w-4 h-4 text-green-600"
            />
            <div>
              <div className="font-medium text-green-900 dark:text-green-100">Accept Edits</div>
              <div className="text-sm text-green-700 dark:text-green-300">
                All commands run automatically within the workspace.
                Full auto mode with sandboxed execution.
              </div>
            </div>
          </label>
        </div>

        {/* Bypass Permissions Mode */}
        <div
          className={`border rounded-lg p-4 cursor-pointer transition-all ${
            permissionMode === 'bypassPermissions'
              ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-400 dark:border-orange-600'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          onClick={() => setPermissionMode('bypassPermissions')}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'bypassPermissions'}
              onChange={() => setPermissionMode('bypassPermissions')}
              className="mt-1 w-4 h-4 text-orange-600"
            />
            <div>
              <div className="font-medium text-orange-900 dark:text-orange-100 flex items-center gap-2">
                Bypass Permissions
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="text-sm text-orange-700 dark:text-orange-300">
                Full system access with no restrictions. All commands run automatically
                with full disk and network access. Use with caution.
              </div>
            </div>
          </label>
        </div>

        {/* Technical Details */}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Technical details
          </summary>
          <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-xs text-muted-foreground space-y-2">
            <p><strong>Default:</strong> sandboxMode=workspace-write, approvalPolicy=untrusted. Trusted commands: cat, cd, grep, head, ls, pwd, tail, git status/log/diff/show, find (without -exec), etc.</p>
            <p><strong>Accept Edits:</strong> sandboxMode=workspace-write, approvalPolicy=never. All commands auto-execute within project directory.</p>
            <p><strong>Bypass Permissions:</strong> sandboxMode=danger-full-access, approvalPolicy=never. Full system access, use only in trusted environments.</p>
            <p className="text-xs opacity-75">You can override this per-session using the mode button in the chat interface.</p>
          </div>
        </details>
      </div>
    </div>
  );
}

// Main component
export default function PermissionsContent({ agent, ...props }) {
  if (agent === 'claude') {
    return <ClaudePermissions {...props} />;
  }
  if (agent === 'cursor') {
    return <CursorPermissions {...props} />;
  }
  if (agent === 'codex') {
    return <CodexPermissions {...props} />;
  }
  return null;
}
