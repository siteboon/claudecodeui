import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlertIcon } from 'lucide-react';

import type { PendingPermissionRequest } from '@/shared/types';
import { Input } from '@/shared/ui';
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

type PermissionRequestActionsProps = {
  toolName: string;
  /** Called with the user's reason, or with none for a bare denial (which stops the turn). */
  onDeny: (reason?: string) => void;
  /** The allow buttons, shown after the two deny buttons. */
  children: React.ReactNode;
};

/**
 * The button row of one permission request. Besides allowing, the user can deny
 * outright, which stops Claude until they reply, or deny with a reason, which
 * Claude reads and continues with, like the CLI's "No, and tell Claude what to
 * do differently".
 */
function PermissionRequestActions({ toolName, onDeny, children }: PermissionRequestActionsProps) {
  const { t } = useTranslation();
  // Whether the reason input replaces the buttons; it opens only when the user
  // chooses to explain the denial, so a plain Deny stays one click.
  const [isWritingReason, setIsWritingReason] = useState(false);
  // The reason being typed, kept until it is sent or the input is closed.
  const [reason, setReason] = useState('');
  const reasonInputRef = useRef<HTMLInputElement>(null);
  const trimmedReason = reason.trim();

  const closeReason = () => {
    setIsWritingReason(false);
    setReason('');
  };

  useEffect(() => {
    if (!isWritingReason) {
      return;
    }
    // The chat stops the run on Escape from a capture listener on `document`.
    // Escape in this input only closes it, so claim the key first: `window`
    // capture runs before it, as the composer menus do.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target !== reasonInputRef.current) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setIsWritingReason(false);
      setReason('');
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [isWritingReason]);

  if (isWritingReason) {
    return (
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          ref={reasonInputRef}
          autoFocus
          type="text"
          enterKeyHint="send"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          onKeyDown={(event) => {
            // Enter that confirms an IME candidate (keyCode 229 on Safari) must not send.
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) {
              return;
            }
            event.preventDefault();
            if (trimmedReason) {
              onDeny(trimmedReason);
            }
          }}
          placeholder={t('chat:permissions.denyReasonPlaceholder')}
          aria-label={t('chat:permissions.denyReasonLabel', { tool: toolName })}
          className="h-8 min-w-0 flex-1 text-base sm:text-sm"
        />
        <div className="flex justify-end gap-2">
          <ConfirmationAction variant="ghost" onClick={closeReason}>
            {t('chat:permissions.cancelDenyReason')}
          </ConfirmationAction>
          <ConfirmationAction variant="default" disabled={!trimmedReason} onClick={() => onDeny(trimmedReason)}>
            {t('chat:permissions.sendDenyReason')}
          </ConfirmationAction>
        </div>
      </div>
    );
  }

  return (
    <ConfirmationActions className="flex-wrap">
      <ConfirmationAction variant="outline" title={t('chat:permissions.denyHint')} onClick={() => onDeny()}>
        {t('chat:permissions.deny')}
      </ConfirmationAction>
      <ConfirmationAction variant="outline" onClick={() => setIsWritingReason(true)}>
        {t('chat:permissions.denyWithReason')}
      </ConfirmationAction>
      {children}
    </ConfirmationActions>
  );
}

type PermissionRequestsBannerProps = {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
};

/**
 * Rendered by chat's ChatComposer above the input to surface pending tool
 * permission requests and their allow/deny/remember actions.
 */
export default function PermissionRequestsBanner({
  pendingPermissionRequests,
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
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const permissionEntry = buildClaudeToolPermissionEntry(request.toolName, rawInput);
        const settings = getClaudeSettings();
        const alreadyAllowed = permissionEntry ? settings.allowedTools.includes(permissionEntry) : false;
        const rememberLabel = alreadyAllowed ? t('chat:permissions.allowSaved') : t('chat:permissions.allowAndRemember');
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
                  <span className="font-medium text-foreground">{t('chat:permissions.required')}</span>
                  <span className="ml-2 text-muted-foreground">
                    {t('chat:permissions.toolLabel')} <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{request.toolName}</code>
                  </span>
                </div>
                {permissionEntry && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('chat:permissions.allowRule')} <code className="rounded bg-muted px-1 py-0.5 text-xs">{permissionEntry}</code>
                  </div>
                )}
              </ConfirmationRequest>
            </ConfirmationTitle>

            {rawInput && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  {t('chat:permissions.viewToolInput')}
                </summary>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/50 p-2 text-xs text-muted-foreground">
                  {rawInput}
                </pre>
              </details>
            )}

            <PermissionRequestActions
              toolName={request.toolName}
              onDeny={(reason) => handlePermissionDecision(request.requestId, reason ? { allow: false, message: reason } : { allow: false })}
            >
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
              <ConfirmationAction
                variant="default"
                onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
              >
                {t('chat:permissions.allowOnce')}
              </ConfirmationAction>
            </PermissionRequestActions>
          </Confirmation>
        );
      })}
    </div>
  );
}
