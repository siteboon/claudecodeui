import React, { useCallback, useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

import type {
  ProjectSession,
  LLMProvider,
  ProviderModelActions,
  ProviderModelsDefinition,
} from "@/shared/types";
import { NextTaskBanner } from "@/modules/task-master";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  Card,
  Button,
  LLMProviderLogo,
} from "@/shared/ui";
import ModelGroupList, { type ModelGroup } from "@/modules/chat/composer/ModelGroupList";
import ModelLibraryPanel from "@/modules/chat/modals/ModelLibraryPanel";
import { writeSelectedProvider } from '@/shared/selectedProvider';

const PROVIDER_META: { id: LLMProvider; name: string }[] = [
  { id: "claude", name: "Anthropic" },
  { id: "codex", name: "OpenAI" },
  { id: "cursor", name: "Cursor" },
  { id: "opencode", name: "OpenCode" },
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
  providerModels: Record<LLMProvider, string>;
  /** Records the pick as this provider's default and persists it. */
  setProviderModel: (provider: LLMProvider, model: string) => void;
  providerModelCatalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>;
  providerModelActions: ProviderModelActions;
  providerModelsLoading: boolean;
  tasksEnabled: boolean;
  isTaskMasterInstalled: boolean | null;
  onShowAllTasks?: (() => void) | null;
  setInput: React.Dispatch<React.SetStateAction<string>>;
};

function getModelConfig(
  p: LLMProvider,
  catalog: Partial<Record<LLMProvider, ProviderModelsDefinition>>,
): ProviderModelsDefinition {
  const entry = catalog[p];
  return entry ?? { OPTIONS: [], DEFAULT: "" };
}

function getProviderDisplayName(p: LLMProvider) {
  if (p === "claude") return "Claude";
  if (p === "cursor") return "Cursor";
  if (p === "codex") return "Codex";
  if (p === "opencode") return "OpenCode";
  return "Claude";
}

/**
 * Rendered by chat's ChatMessagesPane when a session has no messages yet, so
 * the user can pick a provider, model and permission mode before their first turn.
 */
export default function ProviderSelectionEmptyState({
  selectedSession,
  currentSessionId,
  provider,
  setProvider,
  textareaRef,
  providerModels,
  setProviderModel,
  providerModelCatalog,
  providerModelActions,
  providerModelsLoading,
  tasksEnabled,
  isTaskMasterInstalled,
  onShowAllTasks,
  setInput,
}: ProviderSelectionEmptyStateProps) {
  const { t } = useTranslation("chat");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);

  const [modelSearch, setModelSearch] = useState("");

  /**
   * Opens and closes the picker, clearing the search on the way out.
   *
   * The search box is controlled, so a query left behind comes back with the
   * dialog - and brings every branch open with it, since searching expands
   * them. Reopening would undo the collapsing this picker is built around.
   */
  const setPickerOpen = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      setModelSearch("");
    }
  }, []);

  /** One collapsible branch per provider, in the order the picker lists them. */
  const visibleProviderGroups = useMemo<ModelGroup[]>(
    () => PROVIDER_META.map((meta) => ({
      key: meta.id,
      provider: meta.id,
      name: meta.name,
      models: providerModelCatalog[meta.id]?.OPTIONS ?? [],
    })),
    [providerModelCatalog],
  );

  const nextTaskPrompt = t("tasks.nextTaskPrompt", {
    defaultValue: "Start the next task",
  });

  const currentModel = providerModels[provider];

  const currentModelLabel = useMemo(() => {
    const config = getModelConfig(provider, providerModelCatalog);
    const found = config.OPTIONS.find(
      (o: { value: string; label: string }) => o.value === currentModel,
    );
    return found?.label || currentModel;
  }, [provider, currentModel, providerModelCatalog]);

  const handleModelSelect = useCallback(
    (providerId: LLMProvider, modelValue: string) => {
      setProvider(providerId);
      writeSelectedProvider(providerId);
      setProviderModel(providerId, modelValue);
      setPickerOpen(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    },
    [setProvider, setProviderModel, setPickerOpen, textareaRef],
  );

  const openModelLibrary = () => {
    setPickerOpen(false);
    setModelLibraryOpen(true);
  };

  const closeModelLibrary = () => {
    setModelLibraryOpen(false);
    setPickerOpen(true);
  };

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

          <Dialog open={dialogOpen} onOpenChange={setPickerOpen}>
            <DialogTrigger asChild>
              <Card
                className="group mx-auto max-w-xs cursor-pointer border-border/60 transition-all duration-150 hover:border-border hover:shadow-md active:scale-[0.99]"
                role="button"
                tabIndex={0}
              >
                <div className="flex items-center gap-2 p-3">
                  <LLMProviderLogo
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
              <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {t("providerSelection.chooseModel", {
                      defaultValue: "Choose a model",
                    })}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("providerSelection.chooseModelDescription", {
                      defaultValue: "Built-in and custom models in one list",
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={openModelLibrary}
                  className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("providerSelection.addModel", { defaultValue: "Add model" })}
                </Button>
              </div>
              <Command filter={modelSearchFilter}>
                <CommandInput
                  value={modelSearch}
                  onValueChange={setModelSearch}
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
                  <ModelGroupList
                    groups={visibleProviderGroups}
                    provider={provider}
                    currentModel={currentModel}
                    loading={providerModelsLoading}
                    searching={modelSearch.trim().length > 0}
                    onSelect={handleModelSelect}
                    loadingLabel={t("providerSelection.loadingModels", {
                      defaultValue: "Loading models…",
                    })}
                  />
                </CommandList>
              </Command>
            </DialogContent>
          </Dialog>

          <Dialog
            open={modelLibraryOpen}
            onOpenChange={(open) => {
              if (open) {
                setModelLibraryOpen(true);
              } else {
                closeModelLibrary();
              }
            }}
          >
            <DialogContent className="flex h-[min(90dvh,46rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col overflow-hidden rounded-3xl p-4 sm:p-5">
              <DialogTitle>
                {t("providerSelection.manageModels", {
                  defaultValue: "Manage models",
                })}
              </DialogTitle>
              <ModelLibraryPanel
                initialProvider={provider}
                providerModelCatalog={providerModelCatalog}
                actions={providerModelActions}
                onDone={closeModelLibrary}
              />
            </DialogContent>
          </Dialog>

          <p className="mt-4 text-center text-sm text-muted-foreground/70">
            {
              {
                claude: t("providerSelection.readyPrompt.claude", {
                  model: providerModels.claude,
                }),
                cursor: t("providerSelection.readyPrompt.cursor", {
                  model: providerModels.cursor,
                }),
                codex: t("providerSelection.readyPrompt.codex", {
                  model: providerModels.codex,
                }),
                opencode: t("providerSelection.readyPrompt.opencode", {
                  model: providerModels.opencode,
                  defaultValue: "Ready with OpenCode {{model}}",
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
