import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import type { Project, WorkbenchAgent, WorkbenchSession } from '@/shared/types';
import { getErrorText } from '@/shared/utils';
import { Button, Dialog, DialogContent, DialogTitle, Input, LLMProviderLogo } from '@/shared/ui';

const CUSTOM_FOLDER = '__custom__';
const AGENTS: WorkbenchAgent[] = ['claude', 'codex'];

type NewSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: Project[];
  /** Called with the created session; the caller selects it and refreshes the list. */
  onCreated: (session: WorkbenchSession) => void;
  /** Called from the submit click (a user gesture) so browser notification permission can be requested. */
  onSubmitGesture: () => void;
};

/** Rendered by WorkbenchSessionsSection to collect project, base branch, agent, first prompt and title for a new worktree session. */
export default function NewSessionDialog({
  open,
  onOpenChange,
  projects,
  onCreated,
  onSubmitGesture,
}: NewSessionDialogProps) {
  const { t } = useTranslation('workbench');
  // Form fields are local state: nothing outside the dialog needs them, and they reset on close.
  const [projectChoice, setProjectChoice] = useState<string>(projects[0]?.fullPath ?? CUSTOM_FOLDER);
  const [customFolder, setCustomFolder] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [agent, setAgent] = useState<WorkbenchAgent>('claude');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  // Disables the form while the request runs (worktree creation can take a few seconds).
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Server-side failure text (not a git repo, unknown base branch, ...), shown inline.
  const [error, setError] = useState<string | null>(null);

  const projectPath = projectChoice === CUSTOM_FOLDER ? customFolder.trim() : projectChoice;
  const canSubmit = projectPath !== '' && prompt.trim() !== '' && !isSubmitting;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmitGesture();
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await api.workbench.createSession({
        projectPath,
        baseBranch: baseBranch.trim(),
        agent,
        prompt: prompt.trim(),
        title: title.trim(),
      });
      const body = await readApiJson<{ data: { session: WorkbenchSession } }>(response);
      setPrompt('');
      setTitle('');
      onCreated(body.data.session);
      onOpenChange(false);
    } catch (submitError) {
      setError(getErrorText(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-lg p-5" aria-describedby="workbench-new-session-description">
        <DialogTitle className="not-sr-only text-base font-semibold text-foreground">{t('newSession.title')}</DialogTitle>
        <p id="workbench-new-session-description" className="mt-1 text-xs text-muted-foreground">
          {t('newSession.description')}
        </p>

        <form className="mt-4 space-y-3" onSubmit={(event) => void handleSubmit(event)}>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('newSession.project')}</span>
            <select
              value={projectChoice}
              onChange={(event) => setProjectChoice(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              {projects.map((project) => (
                <option key={project.projectId} value={project.fullPath}>
                  {project.displayName}
                </option>
              ))}
              <option value={CUSTOM_FOLDER}>{t('newSession.otherFolder')}</option>
            </select>
          </label>

          {projectChoice === CUSTOM_FOLDER && (
            <Input
              value={customFolder}
              onChange={(event) => setCustomFolder(event.target.value)}
              placeholder={t('newSession.folderPlaceholder')}
              aria-label={t('newSession.otherFolder')}
              autoComplete="off"
            />
          )}

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('newSession.baseBranch')}</span>
            <Input
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              placeholder={t('newSession.baseBranchPlaceholder')}
              autoComplete="off"
            />
          </label>

          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-muted-foreground">{t('newSession.agent')}</legend>
            <div className="flex gap-2">
              {AGENTS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setAgent(option)}
                  aria-pressed={agent === option}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                    agent === option
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-input text-muted-foreground hover:bg-accent/50'
                  }`}
                >
                  <LLMProviderLogo provider={option} className="h-4 w-4" />
                  {t(`agents.${option}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('newSession.prompt')}</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              placeholder={t('newSession.promptPlaceholder')}
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{t('newSession.sessionTitle')}</span>
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('newSession.titlePlaceholder')}
              autoComplete="off"
            />
          </label>

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {isSubmitting ? t('newSession.creating') : t('newSession.create')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
