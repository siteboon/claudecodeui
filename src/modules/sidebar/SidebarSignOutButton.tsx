import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';

import { useAuth } from '@/modules/auth';
import { Button, Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/shared/ui';
import { IS_PLATFORM } from '@/shared/utils';

type SidebarSignOutButtonProps = {
  // Matches the Settings entry it sits under: a text row in the desktop
  // footer, a tile in the mobile footer, an icon in the collapsed rail.
  variant: 'row' | 'tile' | 'icon';
};

const TRIGGER_CLASS_NAMES: Record<SidebarSignOutButtonProps['variant'], string> = {
  row: 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground',
  tile: 'mt-2 flex h-10 w-full items-center gap-3 rounded-xl bg-muted/40 px-3.5 transition-all hover:bg-muted/60 active:scale-[0.98]',
  icon: 'group flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-accent/80',
};

/**
 * Rendered by the sidebar's SidebarFooter (desktop row and mobile tile) and
 * SidebarCollapsed (icon) so a signed-in user can end the session without
 * clearing browser data. Renders nothing in platform mode, where there is no
 * local sign-in to end.
 *
 * Cancel comes first in the dialog so its open-focus lands there: an Enter
 * pressed right after the click cancels instead of signing out. Esc and a
 * click outside also cancel.
 */
export default function SidebarSignOutButton({ variant }: SidebarSignOutButtonProps) {
  const { t } = useTranslation(['sidebar', 'auth']);
  const { logout } = useAuth();
  // Sign-out discards drafts and preferences on this device, so it waits for
  // an explicit confirmation instead of acting on the first click.
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  if (IS_PLATFORM) {
    return null;
  }

  const label = t('auth:logout.button');

  return (
    <Dialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
      <DialogTrigger
        className={TRIGGER_CLASS_NAMES[variant]}
        aria-label={variant === 'icon' ? label : undefined}
        title={variant === 'icon' ? label : undefined}
      >
        {variant === 'row' && (
          <>
            <LogOut className="h-3.5 w-3.5" />
            <span className="text-sm">{label}</span>
          </>
        )}
        {variant === 'tile' && (
          <>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-background/80">
              <LogOut className="h-4 w-4 text-muted-foreground" />
            </div>
            <span className="text-sm font-normal text-foreground">{label}</span>
          </>
        )}
        {variant === 'icon' && (
          <LogOut className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
        )}
      </DialogTrigger>

      <DialogContent aria-describedby="sidebar-sign-out-description" className="max-w-md p-5">
        <DialogTitle className="not-sr-only text-base font-semibold text-foreground">
          {t('auth:logout.title')}
        </DialogTitle>
        <p id="sidebar-sign-out-description" className="mt-2 text-sm text-muted-foreground">
          {t('auth:logout.confirm')}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setIsConfirmOpen(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setIsConfirmOpen(false);
              logout();
            }}
          >
            {label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
