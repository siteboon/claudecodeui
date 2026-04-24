import { Keyboard } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '../../../../shared/view/ui';

import { KbdCombo } from './Kbd';
import { SHORTCUTS } from './shortcuts';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function ShortcutsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden p-0">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
          <Keyboard className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground">Keyboard shortcuts</h3>
        </div>
        <ul className="divide-y divide-border/40">
          {SHORTCUTS.map((shortcut) => (
            <li
              key={shortcut.id}
              className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm"
            >
              <span className="text-foreground">{shortcut.label}</span>
              <KbdCombo keys={shortcut.keys} />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
