import { Folder, Search } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { LoadingProgress } from '../../../../types/app';

type SidebarProjectsStateProps = {
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  projectsCount: number;
  filteredProjectsCount: number;
  t: TFunction;
};

export default function SidebarProjectsState({
  isLoading,
  loadingProgress,
  projectsCount,
  filteredProjectsCount,
  t,
}: SidebarProjectsStateProps) {
  if (isLoading) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">{t('projects.loadingProjects')}</h3>
        {loadingProgress && loadingProgress.total > 0 ? (
          <div className="space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${(loadingProgress.current / loadingProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {loadingProgress.current}/{loadingProgress.total} {t('projects.projects')}
            </p>
            {loadingProgress.currentProject && (
              <p
                className="mx-auto max-w-[200px] truncate text-xs text-muted-foreground/70"
                title={loadingProgress.currentProject}
              >
                {loadingProgress.currentProject.split('-').slice(-2).join('/')}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('projects.fetchingProjects')}</p>
        )}
      </div>
    );
  }

  if (projectsCount === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <Folder className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">{t('projects.noProjects')}</h3>
        <p className="text-sm text-muted-foreground">{t('projects.runClaudeCli')}</p>
      </div>
    );
  }

  if (filteredProjectsCount === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <Search className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">{t('projects.noMatchingProjects')}</h3>
        <p className="text-sm text-muted-foreground">{t('projects.tryDifferentSearch')}</p>
      </div>
    );
  }

  return null;
}
