import { useState } from 'react';
import { AlertTriangle, Plus, Shield, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../../ui/button';
import { Input } from '../../../../ui/input';
import type { CodexPermissionMode } from '../../../types/types';

const COMMON_CLAUDE_TOOLS = [
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
  'WebSearch',
];

const COMMON_CURSOR_COMMANDS = [
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
  'Shell(node)',
];

const addUnique = (items: string[], value: string): string[] => {
  const normalizedValue = value.trim();
  if (!normalizedValue || items.includes(normalizedValue)) {
    return items;
  }

  return [...items, normalizedValue];
};

const removeValue = (items: string[], value: string): string[] => (
  items.filter((item) => item !== value)
);

type ClaudePermissionsProps = {
  agent: 'claude';
  skipPermissions: boolean;
  onSkipPermissionsChange: (value: boolean) => void;
  allowedTools: string[];
  onAllowedToolsChange: (value: string[]) => void;
  disallowedTools: string[];
  onDisallowedToolsChange: (value: string[]) => void;
};

function ClaudePermissions({
  skipPermissions,
  onSkipPermissionsChange,
  allowedTools,
  onAllowedToolsChange,
  disallowedTools,
  onDisallowedToolsChange,
}: Omit<ClaudePermissionsProps, 'agent'>) {
  const { t } = useTranslation('settings');
  const [newAllowedTool, setNewAllowedTool] = useState('');
  const [newDisallowedTool, setNewDisallowedTool] = useState('');

  const handleAddAllowedTool = (tool: string) => {
    const updated = addUnique(allowedTools, tool);
    if (updated.length === allowedTools.length) {
      return;
    }

    onAllowedToolsChange(updated);
    setNewAllowedTool('');
  };

  const handleAddDisallowedTool = (tool: string) => {
    const updated = addUnique(disallowedTools, tool);
    if (updated.length === disallowedTools.length) {
      return;
    }

    onDisallowedToolsChange(updated);
    setNewDisallowedTool('');
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.title')}</h3>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(event) => onSkipPermissionsChange(event.target.checked)}
              className="w-4 h-4 text-blue-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
            />
            <div>
              <div className="font-medium text-orange-900 dark:text-orange-100">
                {t('permissions.skipPermissions.label')}
              </div>
              <div className="text-sm text-orange-700 dark:text-orange-300">
                {t('permissions.skipPermissions.claudeDescription')}
              </div>
            </div>
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.allowedTools.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.allowedTools.description')}</p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newAllowedTool}
            onChange={(event) => setNewAllowedTool(event.target.value)}
            placeholder={t('permissions.allowedTools.placeholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddAllowedTool(newAllowedTool);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => handleAddAllowedTool(newAllowedTool)}
            disabled={!newAllowedTool.trim()}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('permissions.allowedTools.quickAdd')}
          </p>
          <div className="flex flex-wrap gap-2">
            {COMMON_CLAUDE_TOOLS.map((tool) => (
              <Button
                key={tool}
                variant="outline"
                size="sm"
                onClick={() => handleAddAllowedTool(tool)}
                disabled={allowedTools.includes(tool)}
                className="text-xs h-8"
              >
                {tool}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {allowedTools.map((tool) => (
            <div key={tool} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <span className="font-mono text-sm text-green-800 dark:text-green-200">{tool}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAllowedToolsChange(removeValue(allowedTools, tool))}
                className="text-green-600 hover:text-green-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {allowedTools.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              {t('permissions.allowedTools.empty')}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.blockedTools.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.blockedTools.description')}</p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newDisallowedTool}
            onChange={(event) => setNewDisallowedTool(event.target.value)}
            placeholder={t('permissions.blockedTools.placeholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddDisallowedTool(newDisallowedTool);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => handleAddDisallowedTool(newDisallowedTool)}
            disabled={!newDisallowedTool.trim()}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          {disallowedTools.map((tool) => (
            <div key={tool} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <span className="font-mono text-sm text-red-800 dark:text-red-200">{tool}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDisallowedToolsChange(removeValue(disallowedTools, tool))}
                className="text-red-600 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {disallowedTools.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              {t('permissions.blockedTools.empty')}
            </div>
          )}
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2">
          {t('permissions.toolExamples.title')}
        </h4>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git log:*)"</code> {t('permissions.toolExamples.bashGitLog')}</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(git diff:*)"</code> {t('permissions.toolExamples.bashGitDiff')}</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Write"</code> {t('permissions.toolExamples.write')}</li>
          <li><code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">"Bash(rm:*)"</code> {t('permissions.toolExamples.bashRm')}</li>
        </ul>
      </div>
    </div>
  );
}

type CursorPermissionsProps = {
  agent: 'cursor';
  skipPermissions: boolean;
  onSkipPermissionsChange: (value: boolean) => void;
  allowedCommands: string[];
  onAllowedCommandsChange: (value: string[]) => void;
  disallowedCommands: string[];
  onDisallowedCommandsChange: (value: string[]) => void;
};

function CursorPermissions({
  skipPermissions,
  onSkipPermissionsChange,
  allowedCommands,
  onAllowedCommandsChange,
  disallowedCommands,
  onDisallowedCommandsChange,
}: Omit<CursorPermissionsProps, 'agent'>) {
  const { t } = useTranslation('settings');
  const [newAllowedCommand, setNewAllowedCommand] = useState('');
  const [newDisallowedCommand, setNewDisallowedCommand] = useState('');

  const handleAddAllowedCommand = (command: string) => {
    const updated = addUnique(allowedCommands, command);
    if (updated.length === allowedCommands.length) {
      return;
    }

    onAllowedCommandsChange(updated);
    setNewAllowedCommand('');
  };

  const handleAddDisallowedCommand = (command: string) => {
    const updated = addUnique(disallowedCommands, command);
    if (updated.length === disallowedCommands.length) {
      return;
    }

    onDisallowedCommandsChange(updated);
    setNewDisallowedCommand('');
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-orange-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.title')}</h3>
        </div>
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(event) => onSkipPermissionsChange(event.target.checked)}
              className="w-4 h-4 text-purple-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-purple-500 focus:ring-2"
            />
            <div>
              <div className="font-medium text-orange-900 dark:text-orange-100">
                {t('permissions.skipPermissions.label')}
              </div>
              <div className="text-sm text-orange-700 dark:text-orange-300">
                {t('permissions.skipPermissions.cursorDescription')}
              </div>
            </div>
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.allowedCommands.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.allowedCommands.description')}</p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newAllowedCommand}
            onChange={(event) => setNewAllowedCommand(event.target.value)}
            placeholder={t('permissions.allowedCommands.placeholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddAllowedCommand(newAllowedCommand);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => handleAddAllowedCommand(newAllowedCommand)}
            disabled={!newAllowedCommand.trim()}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('permissions.allowedCommands.quickAdd')}
          </p>
          <div className="flex flex-wrap gap-2">
            {COMMON_CURSOR_COMMANDS.map((command) => (
              <Button
                key={command}
                variant="outline"
                size="sm"
                onClick={() => handleAddAllowedCommand(command)}
                disabled={allowedCommands.includes(command)}
                className="text-xs h-8"
              >
                {command}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {allowedCommands.map((command) => (
            <div key={command} className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <span className="font-mono text-sm text-green-800 dark:text-green-200">{command}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAllowedCommandsChange(removeValue(allowedCommands, command))}
                className="text-green-600 hover:text-green-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {allowedCommands.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              {t('permissions.allowedCommands.empty')}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.blockedCommands.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.blockedCommands.description')}</p>

        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newDisallowedCommand}
            onChange={(event) => setNewDisallowedCommand(event.target.value)}
            placeholder={t('permissions.blockedCommands.placeholder')}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleAddDisallowedCommand(newDisallowedCommand);
              }
            }}
            className="flex-1 h-10"
          />
          <Button
            onClick={() => handleAddDisallowedCommand(newDisallowedCommand)}
            disabled={!newDisallowedCommand.trim()}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="w-4 h-4 mr-2 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          {disallowedCommands.map((command) => (
            <div key={command} className="flex items-center justify-between bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <span className="font-mono text-sm text-red-800 dark:text-red-200">{command}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDisallowedCommandsChange(removeValue(disallowedCommands, command))}
                className="text-red-600 hover:text-red-700"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          {disallowedCommands.length === 0 && (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              {t('permissions.blockedCommands.empty')}
            </div>
          )}
        </div>
      </div>

      <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
        <h4 className="font-medium text-purple-900 dark:text-purple-100 mb-2">
          {t('permissions.shellExamples.title')}
        </h4>
        <ul className="text-sm text-purple-800 dark:text-purple-200 space-y-1">
          <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(ls)"</code> {t('permissions.shellExamples.ls')}</li>
          <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(git status)"</code> {t('permissions.shellExamples.gitStatus')}</li>
          <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(npm install)"</code> {t('permissions.shellExamples.npmInstall')}</li>
          <li><code className="bg-purple-100 dark:bg-purple-800 px-1 rounded">"Shell(rm -rf)"</code> {t('permissions.shellExamples.rmRf')}</li>
        </ul>
      </div>
    </div>
  );
}

type CodexPermissionsProps = {
  agent: 'codex';
  permissionMode: CodexPermissionMode;
  onPermissionModeChange: (value: CodexPermissionMode) => void;
};

function CodexPermissions({ permissionMode, onPermissionModeChange }: Omit<CodexPermissionsProps, 'agent'>) {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.codex.permissionMode')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.codex.description')}</p>

        <div
          className={`border rounded-lg p-4 cursor-pointer transition-all ${
            permissionMode === 'default'
              ? 'bg-gray-100 dark:bg-gray-800 border-gray-400 dark:border-gray-500'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          onClick={() => onPermissionModeChange('default')}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'default'}
              onChange={() => onPermissionModeChange('default')}
              className="mt-1 w-4 h-4 text-green-600"
            />
            <div>
              <div className="font-medium text-foreground">{t('permissions.codex.modes.default.title')}</div>
              <div className="text-sm text-muted-foreground">
                {t('permissions.codex.modes.default.description')}
              </div>
            </div>
          </label>
        </div>

        <div
          className={`border rounded-lg p-4 cursor-pointer transition-all ${
            permissionMode === 'acceptEdits'
              ? 'bg-green-50 dark:bg-green-900/20 border-green-400 dark:border-green-600'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          onClick={() => onPermissionModeChange('acceptEdits')}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'acceptEdits'}
              onChange={() => onPermissionModeChange('acceptEdits')}
              className="mt-1 w-4 h-4 text-green-600"
            />
            <div>
              <div className="font-medium text-green-900 dark:text-green-100">{t('permissions.codex.modes.acceptEdits.title')}</div>
              <div className="text-sm text-green-700 dark:text-green-300">
                {t('permissions.codex.modes.acceptEdits.description')}
              </div>
            </div>
          </label>
        </div>

        <div
          className={`border rounded-lg p-4 cursor-pointer transition-all ${
            permissionMode === 'bypassPermissions'
              ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-400 dark:border-orange-600'
              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
          onClick={() => onPermissionModeChange('bypassPermissions')}
        >
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'bypassPermissions'}
              onChange={() => onPermissionModeChange('bypassPermissions')}
              className="mt-1 w-4 h-4 text-orange-600"
            />
            <div>
              <div className="font-medium text-orange-900 dark:text-orange-100 flex items-center gap-2">
                {t('permissions.codex.modes.bypassPermissions.title')}
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="text-sm text-orange-700 dark:text-orange-300">
                {t('permissions.codex.modes.bypassPermissions.description')}
              </div>
            </div>
          </label>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            {t('permissions.codex.technicalDetails')}
          </summary>
          <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-xs text-muted-foreground space-y-2">
            <p><strong>{t('permissions.codex.modes.default.title')}:</strong> {t('permissions.codex.technicalInfo.default')}</p>
            <p><strong>{t('permissions.codex.modes.acceptEdits.title')}:</strong> {t('permissions.codex.technicalInfo.acceptEdits')}</p>
            <p><strong>{t('permissions.codex.modes.bypassPermissions.title')}:</strong> {t('permissions.codex.technicalInfo.bypassPermissions')}</p>
            <p className="text-xs opacity-75">{t('permissions.codex.technicalInfo.overrideNote')}</p>
          </div>
        </details>
      </div>
    </div>
  );
}

type PermissionsContentProps = ClaudePermissionsProps | CursorPermissionsProps | CodexPermissionsProps;

export default function PermissionsContent(props: PermissionsContentProps) {
  if (props.agent === 'claude') {
    return <ClaudePermissions {...props} />;
  }

  if (props.agent === 'cursor') {
    return <CursorPermissions {...props} />;
  }

  return <CodexPermissions {...props} />;
}
