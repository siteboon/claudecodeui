import { useState } from 'react';
import { AlertTriangle, Plus, Shield, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '../../../../../../../shared/view/ui';
import type { CodexPermissionMode, GeminiPermissionMode } from '../../../../../types/types';

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
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.title')}</h3>
        </div>
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-900/20">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(event) => onSkipPermissionsChange(event.target.checked)}
              className="h-4 w-4 rounded border-input bg-card text-primary focus:ring-2 focus:ring-primary"
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
          <Shield className="h-5 w-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.allowedTools.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.allowedTools.description')}</p>

        <div className="flex flex-col gap-2 sm:flex-row">
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
            className="h-10 flex-1"
          />
          <Button
            onClick={() => handleAddAllowedTool(newAllowedTool)}
            disabled={!newAllowedTool.trim()}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="mr-2 h-4 w-4 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
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
                className="h-8 text-xs"
              >
                {tool}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {allowedTools.map((tool) => (
            <div key={tool} className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
              <span className="font-mono text-sm text-green-800 dark:text-green-200">{tool}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAllowedToolsChange(removeValue(allowedTools, tool))}
                className="text-green-600 hover:text-green-700"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {allowedTools.length === 0 && (
            <div className="py-6 text-center text-muted-foreground">
              {t('permissions.allowedTools.empty')}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.blockedTools.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.blockedTools.description')}</p>

        <div className="flex flex-col gap-2 sm:flex-row">
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
            className="h-10 flex-1"
          />
          <Button
            onClick={() => handleAddDisallowedTool(newDisallowedTool)}
            disabled={!newDisallowedTool.trim()}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="mr-2 h-4 w-4 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          {disallowedTools.map((tool) => (
            <div key={tool} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <span className="font-mono text-sm text-red-800 dark:text-red-200">{tool}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDisallowedToolsChange(removeValue(disallowedTools, tool))}
                className="text-red-600 hover:text-red-700"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {disallowedTools.length === 0 && (
            <div className="py-6 text-center text-muted-foreground">
              {t('permissions.blockedTools.empty')}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
        <h4 className="mb-2 font-medium text-blue-900 dark:text-blue-100">
          {t('permissions.toolExamples.title')}
        </h4>
        <ul className="space-y-1 text-sm text-blue-800 dark:text-blue-200">
          <li><code className="rounded bg-blue-100 px-1 dark:bg-blue-800">"Bash(git log:*)"</code> {t('permissions.toolExamples.bashGitLog')}</li>
          <li><code className="rounded bg-blue-100 px-1 dark:bg-blue-800">"Bash(git diff:*)"</code> {t('permissions.toolExamples.bashGitDiff')}</li>
          <li><code className="rounded bg-blue-100 px-1 dark:bg-blue-800">"Write"</code> {t('permissions.toolExamples.write')}</li>
          <li><code className="rounded bg-blue-100 px-1 dark:bg-blue-800">"Bash(rm:*)"</code> {t('permissions.toolExamples.bashRm')}</li>
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
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.title')}</h3>
        </div>
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-900/20">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(event) => onSkipPermissionsChange(event.target.checked)}
              className="h-4 w-4 rounded border-input bg-card text-primary focus:ring-2 focus:ring-primary"
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
          <Shield className="h-5 w-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.allowedCommands.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.allowedCommands.description')}</p>

        <div className="flex flex-col gap-2 sm:flex-row">
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
            className="h-10 flex-1"
          />
          <Button
            onClick={() => handleAddAllowedCommand(newAllowedCommand)}
            disabled={!newAllowedCommand.trim()}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="mr-2 h-4 w-4 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
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
                className="h-8 text-xs"
              >
                {command}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {allowedCommands.map((command) => (
            <div key={command} className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-900/20">
              <span className="font-mono text-sm text-green-800 dark:text-green-200">{command}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAllowedCommandsChange(removeValue(allowedCommands, command))}
                className="text-green-600 hover:text-green-700"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {allowedCommands.length === 0 && (
            <div className="py-6 text-center text-muted-foreground">
              {t('permissions.allowedCommands.empty')}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.blockedCommands.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.blockedCommands.description')}</p>

        <div className="flex flex-col gap-2 sm:flex-row">
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
            className="h-10 flex-1"
          />
          <Button
            onClick={() => handleAddDisallowedCommand(newDisallowedCommand)}
            disabled={!newDisallowedCommand.trim()}
            size="sm"
            className="h-10 px-4"
          >
            <Plus className="mr-2 h-4 w-4 sm:mr-0" />
            <span className="sm:hidden">{t('permissions.actions.add')}</span>
          </Button>
        </div>

        <div className="space-y-2">
          {disallowedCommands.map((command) => (
            <div key={command} className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
              <span className="font-mono text-sm text-red-800 dark:text-red-200">{command}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onDisallowedCommandsChange(removeValue(disallowedCommands, command))}
                className="text-red-600 hover:text-red-700"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {disallowedCommands.length === 0 && (
            <div className="py-6 text-center text-muted-foreground">
              {t('permissions.blockedCommands.empty')}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-900/20">
        <h4 className="mb-2 font-medium text-purple-900 dark:text-purple-100">
          {t('permissions.shellExamples.title')}
        </h4>
        <ul className="space-y-1 text-sm text-purple-800 dark:text-purple-200">
          <li><code className="rounded bg-purple-100 px-1 dark:bg-purple-800">"Shell(ls)"</code> {t('permissions.shellExamples.ls')}</li>
          <li><code className="rounded bg-purple-100 px-1 dark:bg-purple-800">"Shell(git status)"</code> {t('permissions.shellExamples.gitStatus')}</li>
          <li><code className="rounded bg-purple-100 px-1 dark:bg-purple-800">"Shell(npm install)"</code> {t('permissions.shellExamples.npmInstall')}</li>
          <li><code className="rounded bg-purple-100 px-1 dark:bg-purple-800">"Shell(rm -rf)"</code> {t('permissions.shellExamples.rmRf')}</li>
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
          <Shield className="h-5 w-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">{t('permissions.codex.permissionMode')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('permissions.codex.description')}</p>

        <div
          className={`cursor-pointer rounded-lg border p-4 transition-all ${permissionMode === 'default'
            ? 'border-border bg-accent'
            : 'border-border bg-card/50 active:border-border active:bg-accent/50'
            }`}
          onClick={() => onPermissionModeChange('default')}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'default'}
              onChange={() => onPermissionModeChange('default')}
              className="mt-1 h-4 w-4 text-green-600"
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
          className={`cursor-pointer rounded-lg border p-4 transition-all ${permissionMode === 'acceptEdits'
            ? 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20'
            : 'border-border bg-card/50 active:border-border active:bg-accent/50'
            }`}
          onClick={() => onPermissionModeChange('acceptEdits')}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'acceptEdits'}
              onChange={() => onPermissionModeChange('acceptEdits')}
              className="mt-1 h-4 w-4 text-green-600"
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
          className={`cursor-pointer rounded-lg border p-4 transition-all ${permissionMode === 'bypassPermissions'
            ? 'border-orange-400 bg-orange-50 dark:border-orange-600 dark:bg-orange-900/20'
            : 'border-border bg-card/50 active:border-border active:bg-accent/50'
            }`}
          onClick={() => onPermissionModeChange('bypassPermissions')}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="codexPermissionMode"
              checked={permissionMode === 'bypassPermissions'}
              onChange={() => onPermissionModeChange('bypassPermissions')}
              className="mt-1 h-4 w-4 text-orange-600"
            />
            <div>
              <div className="flex items-center gap-2 font-medium text-orange-900 dark:text-orange-100">
                {t('permissions.codex.modes.bypassPermissions.title')}
                <AlertTriangle className="h-4 w-4" />
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
          <div className="mt-2 space-y-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
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

type GeminiPermissionsProps = {
  agent: 'gemini';
  permissionMode: GeminiPermissionMode;
  onPermissionModeChange: (value: GeminiPermissionMode) => void;
};

// Gemini Permissions
function GeminiPermissions({ permissionMode, onPermissionModeChange }: Omit<GeminiPermissionsProps, 'agent'>) {
  const { t } = useTranslation(['settings', 'chat']);
  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-green-500" />
          <h3 className="text-lg font-medium text-foreground">
            {t('gemini.permissionMode')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('gemini.description')}
        </p>

        {/* Default Mode */}
        <div
          className={`cursor-pointer rounded-lg border p-4 transition-all ${permissionMode === 'default'
            ? 'border-border bg-accent'
            : 'border-border bg-card/50 active:border-border active:bg-accent/50'
            }`}
          onClick={() => onPermissionModeChange('default')}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="geminiPermissionMode"
              checked={permissionMode === 'default'}
              onChange={() => onPermissionModeChange('default')}
              className="mt-1 h-4 w-4 text-green-600"
            />
            <div>
              <div className="font-medium text-foreground">{t('gemini.modes.default.title')}</div>
              <div className="text-sm text-muted-foreground">
                {t('gemini.modes.default.description')}
              </div>
            </div>
          </label>
        </div>

        {/* Auto Edit Mode */}
        <div
          className={`cursor-pointer rounded-lg border p-4 transition-all ${permissionMode === 'auto_edit'
            ? 'border-green-400 bg-green-50 dark:border-green-600 dark:bg-green-900/20'
            : 'border-border bg-card/50 active:border-border active:bg-accent/50'
            }`}
          onClick={() => onPermissionModeChange('auto_edit')}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="geminiPermissionMode"
              checked={permissionMode === 'auto_edit'}
              onChange={() => onPermissionModeChange('auto_edit')}
              className="mt-1 h-4 w-4 text-green-600"
            />
            <div>
              <div className="font-medium text-green-900 dark:text-green-100">{t('gemini.modes.autoEdit.title')}</div>
              <div className="text-sm text-green-700 dark:text-green-300">
                {t('gemini.modes.autoEdit.description')}
              </div>
            </div>
          </label>
        </div>

        {/* YOLO Mode */}
        <div
          className={`cursor-pointer rounded-lg border p-4 transition-all ${permissionMode === 'yolo'
            ? 'border-orange-400 bg-orange-50 dark:border-orange-600 dark:bg-orange-900/20'
            : 'border-border bg-card/50 active:border-border active:bg-accent/50'
            }`}
          onClick={() => onPermissionModeChange('yolo')}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="geminiPermissionMode"
              checked={permissionMode === 'yolo'}
              onChange={() => onPermissionModeChange('yolo')}
              className="mt-1 h-4 w-4 text-orange-600"
            />
            <div>
              <div className="flex items-center gap-2 font-medium text-orange-900 dark:text-orange-100">
                {t('gemini.modes.yolo.title')}
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="text-sm text-orange-700 dark:text-orange-300">
                {t('gemini.modes.yolo.description')}
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}

type PermissionsContentProps = ClaudePermissionsProps | CursorPermissionsProps | CodexPermissionsProps | GeminiPermissionsProps;

export default function PermissionsContent(props: PermissionsContentProps) {
  if (props.agent === 'claude') {
    return <ClaudePermissions {...props} />;
  }

  if (props.agent === 'cursor') {
    return <CursorPermissions {...props} />;
  }

  if (props.agent === 'gemini') {
    return <GeminiPermissions {...props} />;
  }

  return <CodexPermissions {...props} />;
}
