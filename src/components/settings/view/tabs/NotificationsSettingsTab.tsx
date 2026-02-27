import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { NotificationPreferencesState } from '../../types/types';

type NotificationsSettingsTabProps = {
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  pushPermission: NotificationPermission | 'unsupported';
  isPushSubscribed: boolean;
  isPushLoading: boolean;
  onEnablePush: () => void;
  onDisablePush: () => void;
};

export default function NotificationsSettingsTab({
  notificationPreferences,
  onNotificationPreferencesChange,
  pushPermission,
  isPushSubscribed,
  isPushLoading,
  onEnablePush,
  onDisablePush,
}: NotificationsSettingsTabProps) {
  const { t } = useTranslation('settings');

  const pushSupported = pushPermission !== 'unsupported';
  const pushDenied = pushPermission === 'denied';

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Bell className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-medium text-foreground">{t('notifications.title')}</h3>
        </div>
        <p className="text-sm text-muted-foreground">{t('notifications.description')}</p>
      </div>

      <div className="space-y-4 bg-card border border-border rounded-lg p-4">
        <h4 className="font-medium text-foreground">{t('notifications.webPush.title')}</h4>
        {!pushSupported ? (
          <p className="text-sm text-muted-foreground">{t('notifications.webPush.unsupported')}</p>
        ) : pushDenied ? (
          <p className="text-sm text-muted-foreground">{t('notifications.webPush.denied')}</p>
        ) : (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isPushSubscribed}
              disabled={isPushLoading}
              onChange={() => {
                if (isPushSubscribed) {
                  onDisablePush();
                } else {
                  onEnablePush();
                }
              }}
              className="w-4 h-4"
            />
            {isPushLoading
              ? t('notifications.webPush.loading')
              : isPushSubscribed
                ? t('notifications.webPush.enabled')
                : t('notifications.webPush.disabled')}
          </label>
        )}
      </div>

      <div className="space-y-4 bg-card border border-border rounded-lg p-4">
        <h4 className="font-medium text-foreground">{t('notifications.events.title')}</h4>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={notificationPreferences.events.actionRequired}
              onChange={(event) =>
                onNotificationPreferencesChange({
                  ...notificationPreferences,
                  events: {
                    ...notificationPreferences.events,
                    actionRequired: event.target.checked,
                  },
                })
              }
              className="w-4 h-4"
            />
            {t('notifications.events.actionRequired')}
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={notificationPreferences.events.stop}
              onChange={(event) =>
                onNotificationPreferencesChange({
                  ...notificationPreferences,
                  events: {
                    ...notificationPreferences.events,
                    stop: event.target.checked,
                  },
                })
              }
              className="w-4 h-4"
            />
            {t('notifications.events.stop')}
          </label>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={notificationPreferences.events.error}
              onChange={(event) =>
                onNotificationPreferencesChange({
                  ...notificationPreferences,
                  events: {
                    ...notificationPreferences.events,
                    error: event.target.checked,
                  },
                })
              }
              className="w-4 h-4"
            />
            {t('notifications.events.error')}
          </label>
        </div>
      </div>
    </div>
  );
}
