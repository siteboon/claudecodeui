import { Folder } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import MobileMenuButton from './MobileMenuButton';
import type { MainContentStateViewProps } from '../../types/types';

export default function MainContentStateView({ mode, isMobile, onMenuClick }: MainContentStateViewProps) {
  const { t } = useTranslation();

  const isLoading = mode === 'loading';

  return (
    <div className="h-full flex flex-col">
      {isMobile && (
        <div className="bg-background/80 backdrop-blur-sm border-b border-border/50 p-2 sm:p-3 pwa-header-safe flex-shrink-0">
          <MobileMenuButton onMenuClick={onMenuClick} compact />
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <div className="w-10 h-10 mx-auto mb-4">
              <div
                className="w-full h-full rounded-full border-[3px] border-muted border-t-primary"
                style={{
                  animation: 'spin 1s linear infinite',
                  WebkitAnimation: 'spin 1s linear infinite',
                  MozAnimation: 'spin 1s linear infinite',
                }}
              />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-1">{t('mainContent.loading')}</h2>
            <p className="text-sm">{t('mainContent.settingUpWorkspace')}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md mx-auto px-6">
            <div className="w-14 h-14 mx-auto mb-5 bg-muted/50 rounded-2xl flex items-center justify-center">
              <Folder className="w-7 h-7 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold mb-2 text-foreground">{t('mainContent.chooseProject')}</h2>
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">{t('mainContent.selectProjectDescription')}</p>
            <div className="bg-primary/5 rounded-xl p-3.5 border border-primary/10">
              <p className="text-sm text-primary">
                <strong>{t('mainContent.tip')}:</strong> {isMobile ? t('mainContent.createProjectMobile') : t('mainContent.createProjectDesktop')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
