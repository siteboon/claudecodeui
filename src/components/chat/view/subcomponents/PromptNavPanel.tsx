import { useTranslation } from 'react-i18next';
import { XIcon, MessageSquareIcon } from 'lucide-react';

interface UserPromptEntry {
  id: string;
  text: string;
  timestamp: number | string;
}

interface PromptNavPanelProps {
  isOpen: boolean;
  onClose: () => void;
  prompts: UserPromptEntry[];
  onJumpTo: (id: string) => void;
}

export default function PromptNavPanel({ isOpen, onClose, prompts, onJumpTo }: PromptNavPanelProps) {
  const { t } = useTranslation('chat');

  const handleJump = (id: string) => {
    onJumpTo(id);
    onClose();
  };

  const fmt = (ts: number | string) => {
    const d = new Date(ts);
    return d.toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/20"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed right-0 top-0 z-40 h-full w-72 transform border-l border-border bg-card shadow-xl transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-hidden={!isOpen}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">
            {t('promptNav.title', { defaultValue: 'Prompts' })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t('promptNav.close', { defaultValue: 'Close' })}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="h-[calc(100%-49px)] overflow-y-auto p-2">
          {prompts.length === 0 ? (
            <div className="mt-8 text-center text-sm text-muted-foreground">
              {t('promptNav.empty', { defaultValue: 'No prompts yet' })}
            </div>
          ) : (
            <ul className="space-y-1">
              {[...prompts].reverse().map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => handleJump(p.id)}
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
                  >
                    <MessageSquareIcon className="mt-0.5 h-3 w-3 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-xs text-foreground">
                        {p.text.length > 60 ? p.text.slice(0, 60) + '...' : p.text}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">{fmt(p.timestamp)}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
