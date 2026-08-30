import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, RotateCcw, Sliders } from 'lucide-react';

import { authenticatedFetch } from '@/shared/api';
import { Button, Input } from '@/shared/ui';
import type { AgentProvider } from '@/shared/types';

/**
 * Sampling settings for one OpenCode model.
 *
 * Only OpenCode has them: the Claude, Cursor and Codex adapters drive their CLI,
 * and none of those takes a temperature. The fields shown here follow the model,
 * not the provider — of the models in the catalog a good sixth refuse a
 * temperature outright (every Anthropic model among them), so the knob is hidden
 * where it would only produce a rejected request.
 */

type ModelCapabilities = {
  temperature: boolean;
  maxOutput?: number;
  contextLimit?: number;
  reasoning: boolean;
};

type ModelOverride = {
  temperature?: number;
  topP?: number;
  maxOutput?: number;
};

type ModelSettings = {
  overridesPath: string;
  applied: boolean;
  models: { value: string; label: string; description?: string }[];
  overrides: Record<string, ModelOverride>;
  capabilities: Record<string, ModelCapabilities>;
};

type Draft = { temperature: string; topP: string; maxOutput: string };

const EMPTY_DRAFT: Draft = { temperature: '', topP: '', maxOutput: '' };

const toDraft = (override?: ModelOverride): Draft => ({
  temperature: override?.temperature === undefined ? '' : String(override.temperature),
  topP: override?.topP === undefined ? '' : String(override.topP),
  maxOutput: override?.maxOutput === undefined ? '' : String(override.maxOutput),
});

function AgentWithoutOptions({ agent }: { agent: AgentProvider }) {
  const name = agent.charAt(0).toUpperCase() + agent.slice(1);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sliders className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Model options</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        {name} runs through its own CLI, and that interface takes no sampling
        parameters — there is no temperature or token limit to set here. What can
        be chosen is the model itself, and its reasoning effort, in the menu next
        to the message box.
      </p>
    </div>
  );
}

export default function ModelOptionsContent({ agent }: { agent: AgentProvider }) {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [status, setStatus] = useState<{ kind: 'error' | 'saved'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await authenticatedFetch('/api/providers/opencode/model-settings');
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.error || 'Could not load the model settings');
      }

      const data = payload.data as ModelSettings;
      setSettings(data);
      setSelected((current) => current || data.models[0]?.value || '');
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    if (agent === 'opencode') {
      void load();
    }
  }, [agent, load]);

  // The inputs follow whatever the server last confirmed for this model.
  useEffect(() => {
    setDraft(toDraft(settings?.overrides[selected]));
  }, [selected, settings]);

  // Only a change of model clears the message. Clearing it whenever settings
  // change would wipe the confirmation the save itself just produced.
  useEffect(() => {
    setStatus(null);
  }, [selected]);

  const capabilities = useMemo(
    () => (settings && selected ? settings.capabilities[selected] : undefined),
    [selected, settings],
  );

  const save = useCallback(async () => {
    if (!selected) {
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const response = await authenticatedFetch('/api/providers/opencode/model-settings', {
        method: 'PUT',
        body: JSON.stringify({
          model: selected,
          temperature: draft.temperature.trim() === '' ? undefined : draft.temperature.trim(),
          topP: draft.topP.trim() === '' ? undefined : draft.topP.trim(),
          maxOutput: draft.maxOutput.trim() === '' ? undefined : draft.maxOutput.trim(),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.error || 'Could not save');
      }

      setSettings(payload.data as ModelSettings);
      setStatus({ kind: 'saved', text: 'Saved. The next run picks it up.' });
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, [draft, selected]);

  if (agent !== 'opencode') {
    return <AgentWithoutOptions agent={agent} />;
  }

  // A failed load leaves `settings` null forever, so the spinner would be the
  // last thing the tab ever shows. The message the load produced belongs here,
  // with a way to try again.
  if (!settings && status?.kind === 'error') {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{status.text}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => { setStatus(null); void load(); }}>
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading the model settings…
      </div>
    );
  }

  const overriddenCount = Object.keys(settings.overrides).length;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Sliders className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Model options</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Sampling settings per model. They are written to a file of CloudCLI&apos;s
          own and merged into OpenCode&apos;s configuration at run time — your
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">opencode.json</code>
          stays untouched.
        </p>
      </div>

      {!settings.applied && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span>
            <code className="rounded bg-muted px-1 py-0.5 text-xs">OPENCODE_CONFIG</code> is
            set in the environment. That variable names a single file, so these
            settings are stored but not applied — unsetting it hands them back to
            OpenCode.
          </span>
        </div>
      )}

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Model</span>
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          {settings.models.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
              {settings.overrides[model.value] ? ' ·' : ''}
            </option>
          ))}
        </select>
      </label>

      {capabilities && (
        <p className="text-xs text-muted-foreground">
          {capabilities.temperature ? 'Takes a temperature' : 'Takes no temperature'}
          {capabilities.maxOutput ? ` · answers with at most ${capabilities.maxOutput.toLocaleString()} tokens` : ''}
          {capabilities.contextLimit ? ` · context ${capabilities.contextLimit.toLocaleString()}` : ''}
          {capabilities.reasoning ? ' · reasons before answering' : ''}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {(!capabilities || capabilities.temperature) && (
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Temperature</span>
            <Input
              value={draft.temperature}
              onChange={(event) => setDraft({ ...draft, temperature: event.target.value })}
              placeholder="model default"
              inputMode="decimal"
            />
          </label>
        )}

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Top P</span>
          <Input
            value={draft.topP}
            onChange={(event) => setDraft({ ...draft, topP: event.target.value })}
            placeholder="model default"
            inputMode="decimal"
          />
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Max output tokens</span>
          <Input
            value={draft.maxOutput}
            onChange={(event) => setDraft({ ...draft, maxOutput: event.target.value })}
            placeholder={capabilities?.maxOutput ? String(capabilities.maxOutput) : 'model default'}
            inputMode="numeric"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy || !selected}>
          {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDraft(EMPTY_DRAFT)}
          disabled={busy || (draft.temperature === '' && draft.topP === '' && draft.maxOutput === '')}
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          Clear
        </Button>
        {status && (
          <span className={status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
            {status.text}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        An empty field hands the value back to the model&apos;s own default.
        {overriddenCount > 0 && ` ${overriddenCount} model${overriddenCount === 1 ? '' : 's'} configured (marked with ·).`}
      </p>
    </div>
  );
}
