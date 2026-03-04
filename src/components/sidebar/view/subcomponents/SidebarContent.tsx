import { ScrollArea } from '../../../ui/scroll-area';
import { Folder, MessageSquare, Search } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Project } from '../../../../types/app';
import type { ReleaseInfo } from '../../../../types/sharedTypes';
import SidebarFooter from './SidebarFooter';
import SidebarHeader from './SidebarHeader';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';

type ConversationMatch = {
  role: string;
  snippet: string;
  matchStart: number;
  matchEnd: number;
  timestamp: string | null;
};

type ConversationSession = {
  sessionId: string;
  sessionSummary: string;
  matches: ConversationMatch[];
};

type ConversationProjectResult = {
  projectName: string;
  projectDisplayName: string;
  sessions: ConversationSession[];
};

type ConversationSearchResults = {
  results: ConversationProjectResult[];
  totalMatches: number;
  query: string;
} | null;

type SearchMode = 'projects' | 'conversations';

function HighlightedSnippet({ snippet, matchStart, matchEnd }: { snippet: string; matchStart: number; matchEnd: number }) {
  const before = snippet.slice(0, matchStart);
  const match = snippet.slice(matchStart, matchEnd);
  const after = snippet.slice(matchEnd);
  return (
    <span className="text-xs text-muted-foreground leading-relaxed">
      {before}
      <mark className="bg-yellow-200 dark:bg-yellow-800 text-foreground rounded-sm px-0.5">{match}</mark>
      {after}
    </span>
  );
}

type SidebarContentProps = {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  projects: Project[];
  searchFilter: string;
  onSearchFilterChange: (value: string) => void;
  onClearSearchFilter: () => void;
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  conversationResults: ConversationSearchResults;
  isSearching: boolean;
  onConversationResultClick: (projectName: string, sessionId: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateProject: () => void;
  onCollapseSidebar: () => void;
  updateAvailable: boolean;
  releaseInfo: ReleaseInfo | null;
  latestVersion: string | null;
  onShowVersionModal: () => void;
  onShowSettings: () => void;
  projectListProps: SidebarProjectListProps;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  projects,
  searchFilter,
  onSearchFilterChange,
  onClearSearchFilter,
  searchMode,
  onSearchModeChange,
  conversationResults,
  isSearching,
  onConversationResultClick,
  onRefresh,
  isRefreshing,
  onCreateProject,
  onCollapseSidebar,
  updateAvailable,
  releaseInfo,
  latestVersion,
  onShowVersionModal,
  onShowSettings,
  projectListProps,
  t,
}: SidebarContentProps) {
  const showConversationSearch = searchMode === 'conversations' && searchFilter.trim().length >= 2;

  return (
    <div
      className="h-full flex flex-col bg-background/80 backdrop-blur-sm md:select-none md:w-72"
      style={{}}
    >
      <SidebarHeader
        isPWA={isPWA}
        isMobile={isMobile}
        isLoading={isLoading}
        projectsCount={projects.length}
        searchFilter={searchFilter}
        onSearchFilterChange={onSearchFilterChange}
        onClearSearchFilter={onClearSearchFilter}
        searchMode={searchMode}
        onSearchModeChange={onSearchModeChange}
        onRefresh={onRefresh}
        isRefreshing={isRefreshing}
        onCreateProject={onCreateProject}
        onCollapseSidebar={onCollapseSidebar}
        t={t}
      />

      <ScrollArea className="flex-1 md:px-1.5 md:py-2 overflow-y-auto overscroll-contain">
        {showConversationSearch ? (
          isSearching ? (
            <div className="text-center py-12 md:py-8 px-4">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4 md:mb-3">
                <div className="w-6 h-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              </div>
              <p className="text-sm text-muted-foreground">{t('search.searching')}</p>
            </div>
          ) : conversationResults && conversationResults.results.length === 0 ? (
            <div className="text-center py-12 md:py-8 px-4">
              <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center mx-auto mb-4 md:mb-3">
                <Search className="w-6 h-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-medium text-foreground mb-2 md:mb-1">{t('search.noResults')}</h3>
              <p className="text-sm text-muted-foreground">{t('search.tryDifferentQuery')}</p>
            </div>
          ) : conversationResults ? (
            <div className="space-y-3 px-2">
              <p className="text-xs text-muted-foreground px-1">
                {conversationResults.totalMatches} {t('search.matches')}
              </p>
              {conversationResults.results.map((projectResult: ConversationProjectResult) => (
                <div key={projectResult.projectName} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1 py-1">
                    <Folder className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-medium text-foreground truncate">
                      {projectResult.projectDisplayName}
                    </span>
                  </div>
                  {projectResult.sessions.map((session: ConversationSession) => (
                    <button
                      key={`${projectResult.projectName}-${session.sessionId}`}
                      className="w-full text-left rounded-md px-2 py-2 hover:bg-accent/50 transition-colors"
                      onClick={() => onConversationResultClick(projectResult.projectName, session.sessionId)}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <MessageSquare className="w-3 h-3 text-primary flex-shrink-0" />
                        <span className="text-xs font-medium text-foreground truncate">
                          {session.sessionSummary}
                        </span>
                      </div>
                      <div className="space-y-1 pl-4">
                        {session.matches.map((match: ConversationMatch, idx: number) => (
                          <div key={idx} className="flex items-start gap-1">
                            <span className="text-[10px] text-muted-foreground/60 font-medium uppercase flex-shrink-0 mt-0.5">
                              {match.role === 'user' ? 'U' : 'A'}
                            </span>
                            <HighlightedSnippet
                              snippet={match.snippet}
                              matchStart={match.matchStart}
                              matchEnd={match.matchEnd}
                            />
                          </div>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : null
        ) : (
          <SidebarProjectList {...projectListProps} />
        )}
      </ScrollArea>

      <SidebarFooter
        updateAvailable={updateAvailable}
        releaseInfo={releaseInfo}
        latestVersion={latestVersion}
        onShowVersionModal={onShowVersionModal}
        onShowSettings={onShowSettings}
        t={t}
      />
    </div>
  );
}
