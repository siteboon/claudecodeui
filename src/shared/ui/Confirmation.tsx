import * as React from 'react';

import { cn } from '@/shared/utils';
import { Alert } from '@/shared/ui/Alert';
import { Button } from '@/shared/ui/Button';

/* ─── Context ────────────────────────────────────────────────────── */

type ApprovalState = 'pending' | 'approved' | 'rejected' | undefined;

type ConfirmationContextValue = {
  approval: ApprovalState;
};

const ConfirmationContext = React.createContext<ConfirmationContextValue | null>(null);

export const useConfirmation = () => {
  const context = React.useContext(ConfirmationContext);
  if (!context) {
    throw new Error('Confirmation components must be used within Confirmation');
  }
  return context;
};

/* ─── Confirmation (root) ────────────────────────────────────────── */

export type ConfirmationProps = {
  approval?: ApprovalState;
} & React.HTMLAttributes<HTMLDivElement>;

/** Used by the chat module to render an inline tool-permission request and its outcome. */
export const Confirmation: React.FC<ConfirmationProps> = ({
  className,
  approval = 'pending',
  children,
  ...props
}) => {
  const contextValue = React.useMemo(() => ({ approval }), [approval]);

  return (
    <ConfirmationContext.Provider value={contextValue}>
      <Alert className={cn('flex flex-col gap-2', className)} {...props}>
        {children}
      </Alert>
    </ConfirmationContext.Provider>
  );
};
Confirmation.displayName = 'Confirmation';

/* ─── ConfirmationTitle ──────────────────────────────────────────── */

export type ConfirmationTitleProps = React.HTMLAttributes<HTMLDivElement>;

/** Title slot of Confirmation, used by the chat module. */
export const ConfirmationTitle: React.FC<ConfirmationTitleProps> = ({
  className,
  ...props
}) => (
  <div
    data-slot="confirmation-title"
    className={cn('text-muted-foreground inline text-sm', className)}
    {...props}
  />
);
ConfirmationTitle.displayName = 'ConfirmationTitle';

/* ─── ConfirmationRequest — visible only when pending ────────────── */

export type ConfirmationRequestProps = {
  children?: React.ReactNode;
};

/** Pending-state slot of Confirmation, used by the chat module. */
export const ConfirmationRequest: React.FC<ConfirmationRequestProps> = ({ children }) => {
  const { approval } = useConfirmation();
  if (approval !== 'pending') return null;
  return <>{children}</>;
};
ConfirmationRequest.displayName = 'ConfirmationRequest';

/* ─── ConfirmationAccepted — visible only when approved ──────────── */

export type ConfirmationAcceptedProps = {
  children?: React.ReactNode;
};

/* ─── ConfirmationRejected — visible only when rejected ──────────── */

export type ConfirmationRejectedProps = {
  children?: React.ReactNode;
};

/* ─── ConfirmationActions — visible only when pending ────────────── */

export type ConfirmationActionsProps = React.HTMLAttributes<HTMLDivElement>;

/** Button row of Confirmation, used by the chat module. */
export const ConfirmationActions: React.FC<ConfirmationActionsProps> = ({
  className,
  ...props
}) => {
  const { approval } = useConfirmation();
  if (approval !== 'pending') return null;

  return (
    <div
      data-slot="confirmation-actions"
      className={cn('flex items-center justify-end gap-2 self-end', className)}
      {...props}
    />
  );
};
ConfirmationActions.displayName = 'ConfirmationActions';

/* ─── ConfirmationAction — styled button ─────────────────────────── */

export type ConfirmationActionProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
};

/** Single allow/deny button inside ConfirmationActions, used by the chat module. */
export const ConfirmationAction: React.FC<ConfirmationActionProps> = ({
  variant = 'default',
  ...props
}) => (
  <Button className="h-8 px-3 text-sm" variant={variant} type="button" {...props} />
);
ConfirmationAction.displayName = 'ConfirmationAction';
