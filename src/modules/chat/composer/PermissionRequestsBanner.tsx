import React from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlertIcon } from 'lucide-react';

import type { PendingPermissionRequest } from '@/shared/types';
import { buildClaudeToolPermissionEntry, formatToolInputForDisplay } from '@/modules/chat/utils/chatPermissions';
import { getClaudeSettings } from '@/modules/chat/utils/chatStorage';
import { getPermissionPanel, registerPermissionPanel } from '@/modules/chat/tools/configs/permissionPanelRegistry';
import { AskUserQuestionPanel } from '@/modules/chat/tools/InteractiveRenderers/AskUserQuestionPanel';
import {
  Confirmation,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRequest,
  ConfirmationTitle,
} from '@/modules/chat/composer/Confirmation';

registerPermissionPanel('AskUserQuestion', AskUserQuestionPanel);

type PermissionRequestsBannerProps = {
  pendingPermissionRequests: PendingPermissionRequest[];
  /** Name of the agent asking, shown in interactive panels such as the question panel. */
  providerLabel?: string;
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
};

/** Reads a string list from a request's context, or null when the context does not carry it. */
const readContextPatterns = (context: unknown, key: 'always' | 'patterns'): string[] | null => {
  const value = context && typeof context === 'object' ? (context as Record<string, unknown>)[key] : undefined;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : null;
};

const PatternList = ({ patterns }: { patterns: string[] }) => (
  <>
    {patterns.map((pattern) => (
      <code key={pattern} className="ml-1 break-all rounded bg-muted px-1 py-0.5 text-xs">{pattern}</code>
    ))}
  </>
);

/**
 * Rendered by chat's ChatComposer above the input to surface pending tool
 * permission requests and their allow/deny/remember actions.
 *
 * A request whose context lists `always` patterns comes from a provider that
 * remembers approvals itself (OpenCode): "Always allow" answers just that
 * request with the provider's own always, and the patterns it covers are shown
 * beside it. Claude's requests instead build an allow rule here and save it in
 * the Claude settings.
 */
export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  providerLabel,
  handlePermissionDecision,
  handleGrantToolPermission,
}: PermissionRequestsBannerProps) {
  const { t } = useTranslation();
  // Filter out plan tool requests — they are handled inline by PlanDisplay
  const filteredRequests = pendingPermissionRequests.filter(
    (r) => r.toolName !== 'ExitPlanMode' && r.toolName !== 'exit_plan_mode'
  );

  if (!filteredRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-2">
      {filteredRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <CustomPanel
              key={request.requestId}
              request={request}
              agentLabel={providerLabel}
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const alwaysPatterns = readContextPatterns(request.context, 'always');
        const requestedPatterns = readContextPatterns(request.context, 'patterns') ?? [];
        const permissionEntry = alwaysPatterns ? null : buildClaudeToolPermissionEntry(request.toolName, rawInput);
        const settings = getClaudeSettings();
        const alreadyAllowed = permissionEntry ? settings.allowedTools.includes(permissionEntry) : false;
        const rememberLabel = alreadyAllowed ? 'Allow (saved)' : 'Allow & remember';
        const matchingRequestIds = permissionEntry
          ? pendingPermissionRequests
              .filter(
                (item) =>
                  buildClaudeToolPermissionEntry(item.toolName, formatToolInputForDisplay(item.input)) === permissionEntry,
              )
              .map((item) => item.requestId)
          : [request.requestId];

        return (
          <Confirmation key={request.requestId} approval="pending">
            <ConfirmationTitle className="flex items-start gap-3">
              <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <ConfirmationRequest>
                <div>
                  <span className="font-medium text-foreground">Permission required</span>
                  <span className="ml-2 text-muted-foreground">
                    Tool: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{request.toolName}</code>
                  </span>
                </div>
                {alwaysPatterns && requestedPatterns.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    <PatternList patterns={requestedPatterns} />
                  </div>
                )}
                {alwaysPatterns && alwaysPatterns.length > 0 && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('chat:agentPrompts.alwaysAllowCovers', { defaultValue: 'Always allow covers' })}:
                    <PatternList patterns={alwaysPatterns} />
                  </div>
                )}
                {permissionEntry && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Allow rule: <code className="rounded bg-muted px-1 py-0.5 text-xs">{permissionEntry}</code>
                  </div>
                )}
              </ConfirmationRequest>
            </ConfirmationTitle>

            {rawInput && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  View tool input
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-2 text-xs text-muted-foreground">
                  {rawInput}
                </pre>
              </details>
            )}

            <ConfirmationActions>
              <ConfirmationAction
                variant="outline"
                onClick={() => handlePermissionDecision(request.requestId, { allow: false, message: t('chat:misc.userDeniedTool') })}
              >
                Deny
              </ConfirmationAction>
              {alwaysPatterns ? (
                <ConfirmationAction
                  variant="outline"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: true, rememberEntry: 'always' })}
                >
                  {t('chat:agentPrompts.alwaysAllow', { defaultValue: 'Always allow' })}
                </ConfirmationAction>
              ) : (
                <ConfirmationAction
                  variant="outline"
                  onClick={() => {
                    if (permissionEntry && !alreadyAllowed) {
                      handleGrantToolPermission({ entry: permissionEntry, toolName: request.toolName });
                    }
                    handlePermissionDecision(matchingRequestIds, { allow: true, rememberEntry: permissionEntry });
                  }}
                  disabled={!permissionEntry}
                >
                  {rememberLabel}
                </ConfirmationAction>
              )}
              <ConfirmationAction
                variant="default"
                onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
              >
                Allow once
              </ConfirmationAction>
            </ConfirmationActions>
          </Confirmation>
        );
      })}
    </div>
  );
}
