import * as React from 'react';
import { cva } from 'class-variance-authority';

import { Button } from '@/shared/ui';
import { cn } from '@/shared/utils';

/**
 * The inline tool-permission request in the chat transcript, and its outcome.
 *
 * It lived in shared/ui, but its whole vocabulary is the permission-request
 * domain — approval pending, allow, deny — and PermissionRequestsBanner has
 * always been its only consumer. Card, Collapsible and Shimmer stay in shared/ui
 * because they are genuinely generic; this is a composition, like PromptInput.
 */

/* ─── Alert — the tinted container ───────────────────────────────── */

// Inlined from shared/ui/Alert, which was never in the barrel and had this file
// as its only importer.
const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive: 'bg-card text-destructive [&>svg]:text-current',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

/* ─── Context ────────────────────────────────────────────────────── */

type ApprovalState = 'pending' | 'approved' | 'rejected' | undefined;

type ConfirmationContextValue = {
  approval: ApprovalState;
};

const ConfirmationContext = React.createContext<ConfirmationContextValue | null>(null);

const useConfirmation = () => {
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

/** Renders an inline tool-permission request and its outcome; used by PermissionRequestsBanner. */
export const Confirmation: React.FC<ConfirmationProps> = ({
  className,
  approval = 'pending',
  children,
  ...props
}) => {
  const contextValue = React.useMemo(() => ({ approval }), [approval]);

  return (
    <ConfirmationContext.Provider value={contextValue}>
      <div
        role="alert"
        data-slot="alert"
        className={cn(alertVariants(), 'flex flex-col gap-2', className)}
        {...props}
      >
        {children}
      </div>
    </ConfirmationContext.Provider>
  );
};
Confirmation.displayName = 'Confirmation';

/* ─── ConfirmationTitle ──────────────────────────────────────────── */

export type ConfirmationTitleProps = React.HTMLAttributes<HTMLDivElement>;

/** Title slot of Confirmation, used by PermissionRequestsBanner. */
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

/** Pending-state slot of Confirmation, used by PermissionRequestsBanner. */
export const ConfirmationRequest: React.FC<ConfirmationRequestProps> = ({ children }) => {
  const { approval } = useConfirmation();
  if (approval !== 'pending') return null;
  return <>{children}</>;
};
ConfirmationRequest.displayName = 'ConfirmationRequest';

/* ─── ConfirmationActions — visible only when pending ────────────── */

export type ConfirmationActionsProps = React.HTMLAttributes<HTMLDivElement>;

/** Button row of Confirmation, used by PermissionRequestsBanner. */
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

/** Single allow/deny button inside ConfirmationActions, used by PermissionRequestsBanner. */
export const ConfirmationAction: React.FC<ConfirmationActionProps> = ({
  variant = 'default',
  ...props
}) => (
  <Button className="h-8 px-3 text-sm" variant={variant} type="button" {...props} />
);
ConfirmationAction.displayName = 'ConfirmationAction';
