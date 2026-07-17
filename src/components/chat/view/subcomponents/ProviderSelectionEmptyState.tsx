import React, { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import type {
  ProjectSession,
  LLMProvider,
  ProviderModelsDefinition,
} from "../../../../types/app";
import SessionProviderLogo from "../../../llm-logo-provider/SessionProviderLogo";
import { NextTaskBanner } from "../../../task-master";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  Card,
} from "../../../../shared/view/ui";

const PROVIDER_META: { id: LLMProvider; name: string }[] = [
  { id: "claude", name: "Anthropic" },
  { id: "codex", name: "OpenAI" },
  { id: "cursor", name: "Cursor" },
  { id: "opencode", name: "OpenCode" },
  { id: "antigravity", name: "Antigravity" },
];

const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

// cmdk's default filter is fuzzy (loose character-subsequence scoring), which
// surfaces unrelated models — e.g. searching "chatgpt" also matched "Fable".
// Require every whitespace-separated search token to appear as a literal
// substring instead, so "claude 4.5" still matches "Anthropic Claude Haiku 4.5"
// but "chatgpt" only matches models that actually contain it.
function modelSearchFilter(value: string, search: string): number {
  const haystack = value.toLowerCase();
  const tokens = search.toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.every((token) => haystack.includes(token)) ? 1 : 0;
}

type ProviderSelectionEmptyStateProps = {
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  provider: LLMProvider;
  setProvider: (next: LLMProvider) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  claudeModel: string;
  setClaudeModel: (model: string) => void;
  cursorModel: string;
  setCursorModel: (model: string) => void;
  codexModel: string;
  setCodexModel: (model: string) => void;
  opencodeModel: string;
  setOpenCodeModel: (model: string) => void;
  antigravityModel: string;
  setAntigravityModel: (model: string) => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelsLoading: boolean;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
};

type ProviderGroup = {
  id: LLMProvider;
  name: string;
  models: { value: string; label: string; description?: string }[];
};

function getModelConfig(
  p: LLMProvider,
  catalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>,
): ProviderModelsDefinition {
  const entry = catalog[p];
  return entry ?? { OPTIONS: [], DEFAULT: "" };
}

function getCurrentModel(
  p: LLMProvider,
  c: string,
  cu: string,
  co: string,
  o: string,
  a: string,
) {
  if (p === "claude") return c;
  if (p === "codex") return co;
  if (p === "opencode") return o;
  if (p === "antigravity") return a;
  return cu;
}

function getProviderDisplayName(p: LLMProvider) {
  if (p === "claude") return "Claude";
  if (p === "cursor") return "Cursor";
  if (p === "codex") return "Codex";
  if (p === "opencode") return "OpenCode";
  if (p === "antigravity") return "Antigravity";
  return "Claude";
}

export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  claudeModel,
  setClaudeModel,
  cursorModel,
  setCursorModel,
  codexModel,
  setCodexModel,
  opencodeModel,
  setOpenCodeModel,
  antigravityModel,
  setAntigravityModel,
  providerModelCatalog,
  providerModelsLoading,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation("chat");
  const [dialogOpen, setDialogOpen] = useState(false);

  const visibleProviderGroups = useMemo<ProviderGroup[]>(() => {
    return PROVIDER_META.map((p) => ({
      id: p.id,
      name: p.name,
      models: providerModelCatalog[p.id]?.OPTIONS ?? [],
    }));
  }, [providerModelCatalog]);

  const nextTaskPrompt = t("tasks.nextTaskPrompt", {
    defaultValue: "Start the next task",
  });

  const currentModel = getCurrentModel(
    provider,
    claudeModel,
    cursorModel,
    codexModel,
    opencodeModel,
    antigravityModel,
  );

  const currentModelLabel = useMemo(() => {
    const config = getModelConfig(provider, providerModelCatalog);
    const found = config.OPTIONS.find(
      (o: { value: string; label: string }) => o.value === currentModel,
    );
    return found?.label || currentModel;
  }, [provider, currentModel, providerModelCatalog]);

  const setModelForProvider = useCallback(
    (providerId: LLMProvider, modelValue: string) => {
      if (providerId === "claude") {
        setClaudeModel(modelValue);
        localStorage.setItem("claude-model", modelValue);
      } else if (providerId === "codex") {
        setCodexModel(modelValue);
        localStorage.setItem("codex-model", modelValue);
      } else if (providerId === "opencode") {
        setOpenCodeModel(modelValue);
        localStorage.setItem("opencode-model", modelValue);
      } else if (providerId === "antigravity") {
        setAntigravityModel(modelValue);
        localStorage.setItem("antigravity-model", modelValue);
      } else {
        setCursorModel(modelValue);
        localStorage.setItem("cursor-model", modelValue);
      }
    },
    [setClaudeModel, setCursorModel, setCodexModel, setOpenCodeModel, setAntigravityModel],
  );

  const handleModelSelect = useCallback(
    (providerId: LLMProvider, modelValue: string) => {
      setProvider(providerId);
      localStorage.setItem("selected-provider", providerId);
      setModelForProvider(providerId, modelValue);
      setDialogOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    },
    [setProvider, setModelForProvider, textareaRef],
  );

  if (!selectedSession && !currentSessionId) {
    return (
      <div className="flex h-full items-center justify-center px-4">
        <div className="w-full max-w-[34.25rem]">
          <div className="mb-8 text-center">
            <h2 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {t("providerSelection.title")}
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {t("providerSelection.description")}
            </p>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Card
                className="group mx-auto max-w-xs cursor-pointer border-border/60 transition-all duration-150 hover:border-border hover:shadow-md active:scale-[0.99]"
                role="button"
                tabIndex={0}
              >
                <div className="flex items-center gap-2 p-3">
                  <SessionProviderLogo
                    provider={provider}
                    className="h-5 w-5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs font-semibold text-foreground">
                        {getProviderDisplayName(provider)}
                      </span>
                      <span className="text-xs text-muted-foreground">·</span>
                      <span className="truncate text-xs text-foreground">
                        {currentModelLabel}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {t("providerSelection.clickToChange", {
                        defaultValue: "Click to change model",
                      })}
                    </p>
                  </div>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-y-0.5" />
                </div>
              </Card>
            </DialogTrigger>

            <DialogContent className="max-w-md overflow-hidden p-0">
              <DialogTitle>Model Selector</DialogTitle>
              <div className="border-b border-border/60 bg-muted/20 px-4 py-3">
                <p className="text-sm font-semibold text-foreground">Choose a model</p>
              </div>
              <Command filter={modelSearchFilter}>
                <CommandInput
                  placeholder={t("providerSelection.searchModels", {
                    defaultValue: "Search models...",
                  })}
                />
                <CommandList className="max-h-[350px]">
                  <CommandEmpty>
                    {t("providerSelection.noModelsFound", {
                      defaultValue: "No models found.",
                    })}
                  </CommandEmpty>
                  {visibleProviderGroups.map((group, idx) => (
                    <CommandGroup
                      key={group.id}
                      className={
                        idx > 0
                          ? "border-t border-border/40 [&_[cmdk-group-heading]]:mt-1 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                          : "[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                      }
                      heading={
                        <span className="flex items-center gap-1.5">
                          <SessionProviderLogo provider={group.id} className="h-3.5 w-3.5 shrink-0" />
                          {group.name}
                        </span>
                      }
                    >
                      {group.models.length === 0 && providerModelsLoading ? (
                        <CommandItem disabled className="ml-4 border-l border-border/40 pl-4 text-muted-foreground">
                          {t("providerSelection.loadingModels", { defaultValue: "Loading models…" })}
                        </CommandItem>
                      ) : null}
                      {group.models.map((model) => {
                        const isSelected = provider === group.id && currentModel === model.value;
                        return (
                          <CommandItem
                            key={`${group.id}-${model.value}`}
                            value={`${group.name} ${model.label} ${model.description || ''}`}
                            onSelect={() => handleModelSelect(group.id, model.value)}
                            className="ml-4 border-l border-border/40 pl-4"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate">{model.label}</div>
                              {/* 
                              // * Temporarly commented out because the description of models from claude 
                              // * was a bit inconsistent.  Will return it back when it becomes more consistent.
                              */}
                              {/* {model.description && (
                                <div className="truncate text-xs text-muted-foreground">
                                  {model.description}
                                </div>
                              )} */}
                            </div>
                            {isSelected && (
                              <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />
                            )}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </DialogContent>
          </Dialog>

          <p className="mt-4 text-center text-sm text-muted-foreground/70">
            {
              {
                claude: t("providerSelection.readyPrompt.claude", {
                  model: claudeModel,
                }),
                cursor: t("providerSelection.readyPrompt.cursor", {
                  model: cursorModel,
                }),
                codex: t("providerSelection.readyPrompt.codex", {
                  model: codexModel,
                }),
                opencode: t("providerSelection.readyPrompt.opencode", {
                  model: opencodeModel,
                  defaultValue: "Ready with OpenCode {{model}}",
                }),
                antigravity: t("providerSelection.readyPrompt.antigravity", {
                  model: antigravityModel,
                  defaultValue: "Ready with Antigravity {{model}}",
                }),
              }[provider]
            }
          </p>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground/60">
            <Trans
              ns="chat"
              i18nKey="providerSelection.pressToSearch"
              values={{ shortcut: MOD_KEY === "⌘" ? "⌘K" : "Ctrl+K" }}
              components={{
                kbd: (
                  <kbd className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px]" />
                ),
              }}
            />
          </p>

          {provider && tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (selectedSession) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-[34.25rem] px-6 text-center">
          <p className="mb-1.5 text-lg font-semibold text-foreground">
            {t("session.continue.title")}
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("session.continue.description")}
          </p>

          {tasksEnabled && isTaskMasterInstalled && (
            <div className="mt-5">
              <NextTaskBanner
                onStartTask={() => setInput(nextTaskPrompt)}
                onShowAllTasks={onShowAllTasks}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  return null;
}
