import * as React from 'react';

import { cn } from '../../../lib/utils';
import { Alert } from './Alert';
import { Button } from './Button';

/* ─── Context ────────────────────────────────────────────────────── */

type ApprovalState = 'pending' | 'approved' | 'rejected' | undefined;

interface ConfirmationContextValue {
  approval: ApprovalState;
}

const ConfirmationContext = React.createContext<ConfirmationContextValue | null>(null);

const useConfirmation = () => {
  const context = React.useContext(ConfirmationContext);
  if (!context) {
    throw new Error('Confirmation components must be used within Confirmation');
  }
  return context;
};

/* ─── Confirmation (root) ────────────────────────────────────────── */

export interface ConfirmationProps extends React.HTMLAttributes<HTMLDivElement> {
  approval?: ApprovalState;
}

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

export interface ConfirmationRequestProps {
  children?: React.ReactNode;
}

export const ConfirmationRequest: React.FC<ConfirmationRequestProps> = ({ children }) => {
  const { approval } = useConfirmation();
  if (approval !== 'pending') return null;
  return <>{children}</>;
};
ConfirmationRequest.displayName = 'ConfirmationRequest';

/* ─── ConfirmationAccepted — visible only when approved ──────────── */

export interface ConfirmationAcceptedProps {
  children?: React.ReactNode;
}

export const ConfirmationAccepted: React.FC<ConfirmationAcceptedProps> = ({ children }) => {
  const { approval } = useConfirmation();
  if (approval !== 'approved') return null;
  return <>{children}</>;
};
ConfirmationAccepted.displayName = 'ConfirmationAccepted';

/* ─── ConfirmationRejected — visible only when rejected ──────────── */

export interface ConfirmationRejectedProps {
  children?: React.ReactNode;
}

export const ConfirmationRejected: React.FC<ConfirmationRejectedProps> = ({ children }) => {
  const { approval } = useConfirmation();
  if (approval !== 'rejected') return null;
  return <>{children}</>;
};
ConfirmationRejected.displayName = 'ConfirmationRejected';

/* ─── ConfirmationActions — visible only when pending ────────────── */

export type ConfirmationActionsProps = React.HTMLAttributes<HTMLDivElement>;

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

export const ConfirmationAction: React.FC<ConfirmationActionProps> = ({
  variant = 'default',
  ...props
}) => (
  <Button className="h-8 px-3 text-sm" variant={variant} type="button" {...props} />
);
ConfirmationAction.displayName = 'ConfirmationAction';

export { useConfirmation };
