import { useCallback, useEffect, useState } from 'react';
import { useBeads } from '../../../../contexts/BeadsContext';
import { useTasksSettings } from '../../../../contexts/TasksSettingsContext';
import type { Project } from '../../../../types/app';

export interface BeadsIssue {
  id: string;
  title: string;
  status: string;
  priority: number;
  issue_type: string;
  owner: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  dependency_count?: number;
  dependent_count?: number;
  comment_count?: number;
  dependencies?: Array<{
    issue_id: string;
    depends_on_id: string;
    type: string;
  }>;
}

export interface BeadsPanelProps {
  isVisible: boolean;
}

type BeadsContextValue = {
  issues?: BeadsIssue[];
  epics?: BeadsIssue[];
  readyIssues?: BeadsIssue[];
  currentProject?: Project | null;
  refreshIssues?: (force?: boolean) => void;
  refreshEpics?: () => void;
  getChildren?: (issueId: string) => Promise<BeadsIssue[]> | void;
  getDependencies?: (issueId: string) => Promise<any[]> | void;
  addDependency?: (blockedId: string, blockerId: string) => Promise<unknown> | void;
  createIssue?: (data: { 
    title: string; 
    description?: string; 
    priority?: number; 
    type?: string;
    parent?: string;
    deps?: string[];
  }) => Promise<unknown> | void;
  updateIssue?: (id: string, data: { status?: string; title?: string; priority?: number }) => Promise<unknown> | void;
  closeIssue?: (id: string) => Promise<unknown> | void;
  isLoadingIssues?: boolean;
};

type TasksSettingsContextValue = {
  isBeadsInstalled: boolean | null;
  isBeadsReady: boolean | null;
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-500',
  in_progress: 'bg-yellow-500',
  done: 'bg-green-500',
  closed: 'bg-green-500',
  blocked: 'bg-red-500',
  deferred: 'bg-gray-500',
  cancelled: 'bg-gray-400'
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  done: 'Done',
  closed: 'Closed',
  blocked: 'Blocked',
  deferred: 'Deferred',
  cancelled: 'Cancelled'
};

const PRIORITY_COLORS: Record<number, string> = {
  1: 'text-red-500',
  2: 'text-orange-500',
  3: 'text-yellow-500',
  4: 'text-blue-500',
  5: 'text-gray-500'
};

const PRIORITY_LABELS: Record<number, string> = {
  1: 'P1 - Critical',
  2: 'P2 - High',
  3: 'P3 - Medium',
  4: 'P4 - Low',
  5: 'P5 - Backlog'
};

const TYPE_COLORS: Record<string, string> = {
  epic: 'bg-purple-500',
  task: 'bg-gray-500',
  bug: 'bg-red-500',
  feature: 'bg-green-500',
  chore: 'bg-yellow-600'
};

const TYPE_ICONS: Record<string, string> = {
  epic: '📦',
  task: '✓',
  bug: '🐛',
  feature: '✨',
  chore: '🔧'
};

export default function BeadsPanel({ isVisible }: BeadsPanelProps) {
  const { 
    issues = [], 
    epics = [],
    readyIssues = [], 
    currentProject, 
    refreshIssues,
    refreshEpics,
    getChildren,
    getDependencies,
    createIssue,
    updateIssue,
    closeIssue,
    isLoadingIssues = false
  } = useBeads() as BeadsContextValue;
  
  const { isBeadsInstalled } = useTasksSettings() as TasksSettingsContextValue;
  
  const [selectedIssue, setSelectedIssue] = useState<BeadsIssue | null>(null);
  const [selectedIssueChildren, setSelectedIssueChildren] = useState<BeadsIssue[]>([]);
  const [selectedIssueDeps, setSelectedIssueDeps] = useState<any[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [newIssuePriority, setNewIssuePriority] = useState(3);
  const [newIssueType, setNewIssueType] = useState('task');
  const [newIssueParent, setNewIssueParent] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'epics'>('list');
  const [isCreating, setIsCreating] = useState(false);
  const [expandedEpics, setExpandedEpics] = useState<Set<string>>(new Set());

  const handleIssueClick = useCallback(async (issue: BeadsIssue) => {
    setSelectedIssue(issue);
    
    if (issue.issue_type === 'epic' && getChildren) {
      const children = await getChildren(issue.id);
      setSelectedIssueChildren(children || []);
    } else {
      setSelectedIssueChildren([]);
    }
    
    if (getDependencies) {
      const deps = await getDependencies(issue.id);
      setSelectedIssueDeps(deps || []);
    } else {
      setSelectedIssueDeps([]);
    }
  }, [getChildren, getDependencies]);

  const handleCloseDetail = useCallback(() => {
    setSelectedIssue(null);
    setSelectedIssueChildren([]);
    setSelectedIssueDeps([]);
  }, []);

  const handleCreateIssue = useCallback(async () => {
    if (!newIssueTitle.trim() || !createIssue) return;
    
    setIsCreating(true);
    try {
      const issueData: any = {
        title: newIssueTitle.trim(),
        priority: newIssuePriority,
        type: newIssueType
      };
      
      if (newIssueParent) {
        issueData.parent = newIssueParent;
      }
      
      await createIssue(issueData);
      setNewIssueTitle('');
      setNewIssuePriority(3);
      setNewIssueType('task');
      setNewIssueParent('');
      setShowCreateForm(false);
      refreshIssues?.(true);
      refreshEpics?.();
    } catch (error) {
      console.error('Failed to create issue:', error);
    } finally {
      setIsCreating(false);
    }
  }, [newIssueTitle, newIssuePriority, newIssueType, newIssueParent, createIssue, refreshIssues, refreshEpics]);

  const handleStatusChange = useCallback(async (issueId: string, newStatus: string) => {
    if (!updateIssue) return;
    
    try {
      if (newStatus === 'closed' || newStatus === 'done') {
        await closeIssue?.(issueId);
      } else {
        await updateIssue(issueId, { status: newStatus });
      }
      refreshIssues?.(true);
      refreshEpics?.();
    } catch (error) {
      console.error('Failed to update issue status:', error);
    }
  }, [updateIssue, closeIssue, refreshIssues, refreshEpics]);

  const toggleEpicExpansion = useCallback((epicId: string) => {
    setExpandedEpics(prev => {
      const next = new Set(prev);
      if (next.has(epicId)) {
        next.delete(epicId);
      } else {
        next.add(epicId);
      }
      return next;
    });
  }, []);

  const filteredIssues = issues.filter(issue => {
    if (filterStatus !== 'all') {
      if (filterStatus === 'open' && issue.status !== 'open') return false;
      if (filterStatus === 'in_progress' && issue.status !== 'in_progress') return false;
      if (filterStatus === 'closed' && issue.status !== 'closed' && issue.status !== 'done') return false;
    }
    if (filterType !== 'all' && issue.issue_type !== filterType) return false;
    return true;
  });

  const groupedByEpic = useCallback(() => {
    const epicsList = issues.filter(i => i.issue_type === 'epic');
    const standalone = issues.filter(i => {
      if (i.issue_type === 'epic') return false;
      const hasParent = i.dependencies?.some(d => d.type === 'parent-child');
      return !hasParent;
    });
    return { epicsList, standalone };
  }, [issues]);

  if (!isBeadsInstalled) {
    return (
      <div className={`h-full ${isVisible ? 'block' : 'hidden'}`}>
        <div className="h-full flex flex-col items-center justify-center p-8 text-center">
          <div className="max-w-md">
            <h2 className="text-xl font-semibold mb-4">Beads Not Installed</h2>
            <p className="text-gray-400 mb-4">
              Beads is a lightweight issue tracker that lives in your repo.
              Install it to start tracking issues alongside your code.
            </p>
            <code className="bg-gray-800 px-3 py-2 rounded text-sm block mb-4">
              curl -sSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash
            </code>
            <p className="text-sm text-gray-500">
              Then run <code className="bg-gray-800 px-1 rounded">bd init</code> in your project directory.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`h-full ${isVisible ? 'block' : 'hidden'}`}>
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Beads Issues</h2>
            <span className="text-sm text-gray-400">
              {issues.length} total
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex bg-gray-800 rounded p-0.5">
              <button
                onClick={() => setViewMode('list')}
                className={`px-2 py-1 rounded text-xs ${viewMode === 'list' ? 'bg-gray-600' : ''}`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode('epics')}
                className={`px-2 py-1 rounded text-xs ${viewMode === 'epics' ? 'bg-gray-600' : ''}`}
              >
                Epics
              </button>
            </div>
            
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option value="all">All Status</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="closed">Closed</option>
            </select>
            
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
            >
              <option value="all">All Types</option>
              <option value="epic">Epics</option>
              <option value="task">Tasks</option>
              <option value="bug">Bugs</option>
              <option value="feature">Features</option>
              <option value="chore">Chores</option>
            </select>
            
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
            >
              New Issue
            </button>
          </div>
        </div>

        {/* Create Issue Form */}
        {showCreateForm && (
          <div className="p-4 border-b border-gray-700 bg-gray-800">
            <input
              type="text"
              value={newIssueTitle}
              onChange={(e) => setNewIssueTitle(e.target.value)}
              placeholder="Issue title..."
              className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 mb-2"
            />
            <div className="flex items-center gap-2 mb-2">
              <select
                value={newIssueType}
                onChange={(e) => setNewIssueType(e.target.value)}
                className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm flex-1"
              >
                <option value="task">Task</option>
                <option value="epic">Epic</option>
                <option value="bug">Bug</option>
                <option value="feature">Feature</option>
                <option value="chore">Chore</option>
              </select>
              <select
                value={newIssuePriority}
                onChange={(e) => setNewIssuePriority(parseInt(e.target.value))}
                className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm flex-1"
              >
                <option value={1}>P1 - Critical</option>
                <option value={2}>P2 - High</option>
                <option value={3}>P3 - Medium</option>
                <option value={4}>P4 - Low</option>
                <option value={5}>P5 - Backlog</option>
              </select>
            </div>
            {newIssueType !== 'epic' && epics.length > 0 && (
              <select
                value={newIssueParent}
                onChange={(e) => setNewIssueParent(e.target.value)}
                className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm mb-2"
              >
                <option value="">No parent (standalone)</option>
                {epics.map(epic => (
                  <option key={epic.id} value={epic.id}>{epic.title}</option>
                ))}
              </select>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreateForm(false)}
                className="px-3 py-1 rounded text-sm border border-gray-600 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateIssue}
                disabled={!newIssueTitle.trim() || isCreating}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-3 py-1 rounded text-sm"
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Ready to Work Section */}
        {readyIssues.length > 0 && viewMode === 'list' && (
          <div className="p-4 border-b border-gray-700 bg-gray-800/50">
            <h3 className="text-sm font-medium text-green-400 mb-2">Ready to Work ({readyIssues.length})</h3>
            <div className="space-y-1">
              {readyIssues.slice(0, 5).map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => handleIssueClick(issue)}
                  className="w-full text-left p-2 rounded bg-gray-900 hover:bg-gray-700 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs">{TYPE_ICONS[issue.issue_type] || '○'}</span>
                    <span className="text-xs font-mono text-gray-400">{issue.id}</span>
                    <span className="text-sm truncate">{issue.title}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Issue List */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoadingIssues ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-400">Loading issues...</div>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-400">
                {filterStatus === 'all' && filterType === 'all' ? 'No issues found' : 'No matching issues'}
              </div>
            </div>
          ) : viewMode === 'epics' ? (
            /* Epic View */
            <div className="space-y-4">
              {(() => {
                const { epicsList, standalone } = groupedByEpic();
                return (
                  <>
                    {epicsList.map((epic) => (
                      <div key={epic.id} className="border border-gray-700 rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleEpicExpansion(epic.id)}
                          className="w-full p-3 bg-gray-800 hover:bg-gray-750 flex items-center gap-3"
                        >
                          <span className="text-lg">{expandedEpics.has(epic.id) ? '▼' : '▶'}</span>
                          <span className={`w-3 h-3 rounded ${TYPE_COLORS[epic.issue_type] || 'bg-gray-500'}`} />
                          <span className="text-xl">{TYPE_ICONS[epic.issue_type]}</span>
                          <div className="flex-1 text-left">
                            <div className="font-medium">{epic.title}</div>
                            <div className="text-xs text-gray-400">{epic.id} · Epic</div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-xs ${STATUS_COLORS[epic.status]} text-white`}>
                            {STATUS_LABELS[epic.status] || epic.status}
                          </span>
                        </button>
                        {expandedEpics.has(epic.id) && (
                          <div className="bg-gray-900 p-2">
                            {selectedIssueChildren.filter(c => c.dependencies?.some(d => d.depends_on_id === epic.id && d.type === 'parent-child')).length === 0 ? (
                              <div className="text-sm text-gray-500 p-2">No children yet</div>
                            ) : (
                              <div className="space-y-1">
                                {/* Children will be loaded on epic expansion */}
                              </div>
                            )}
                            <button
                              onClick={() => {
                                setNewIssueParent(epic.id);
                                setNewIssueType('task');
                                setShowCreateForm(true);
                              }}
                              className="mt-2 text-sm text-blue-400 hover:text-blue-300"
                            >
                              + Add child task
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {standalone.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium text-gray-400 mb-2">Standalone Issues</h3>
                        <div className="space-y-2">
                          {standalone.map((issue) => (
                            <button
                              key={issue.id}
                              onClick={() => handleIssueClick(issue)}
                              className={`w-full text-left p-3 rounded border transition-colors ${
                                selectedIssue?.id === issue.id
                                  ? 'bg-blue-900/30 border-blue-500'
                                  : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <span className="text-lg">{TYPE_ICONS[issue.issue_type] || '○'}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-mono text-gray-400">{issue.id}</span>
                                    <span className={`text-xs ${PRIORITY_COLORS[issue.priority] || ''}`}>
                                      P{issue.priority}
                                    </span>
                                    <span className={`px-1.5 py-0.5 rounded text-xs ${TYPE_COLORS[issue.issue_type]} text-white`}>
                                      {issue.issue_type}
                                    </span>
                                  </div>
                                  <div className="text-sm font-medium truncate">{issue.title}</div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            /* List View */
            <div className="space-y-2">
              {filteredIssues.map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => handleIssueClick(issue)}
                  className={`w-full text-left p-3 rounded border transition-colors ${
                    selectedIssue?.id === issue.id
                      ? 'bg-blue-900/30 border-blue-500'
                      : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-2 h-2 rounded-full mt-2 ${STATUS_COLORS[issue.status] || 'bg-gray-500'}`} />
                    <span className="text-lg mt-0.5">{TYPE_ICONS[issue.issue_type] || '○'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-gray-400">{issue.id}</span>
                        <span className={`text-xs ${PRIORITY_COLORS[issue.priority] || ''}`}>
                          {PRIORITY_LABELS[issue.priority] || `P${issue.priority}`}
                        </span>
                        {issue.issue_type !== 'task' && (
                          <span className={`px-1.5 py-0.5 rounded text-xs ${TYPE_COLORS[issue.issue_type]} text-white`}>
                            {issue.issue_type}
                          </span>
                        )}
                        {(issue.dependency_count || 0) > 0 && (
                          <span className="text-xs text-gray-500">🔒 {issue.dependency_count}</span>
                        )}
                        {(issue.dependent_count || 0) > 0 && (
                          <span className="text-xs text-gray-500">→ {issue.dependent_count}</span>
                        )}
                      </div>
                      <div className="text-sm font-medium truncate">{issue.title}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {STATUS_LABELS[issue.status] || issue.status}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Issue Detail Modal */}
        {selectedIssue && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
              <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{TYPE_ICONS[selectedIssue.issue_type] || '○'}</span>
                  <span className="text-sm font-mono text-gray-400">{selectedIssue.id}</span>
                  <span className={`text-xs ${PRIORITY_COLORS[selectedIssue.priority] || ''}`}>
                    {PRIORITY_LABELS[selectedIssue.priority] || `P${selectedIssue.priority}`}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-xs ${TYPE_COLORS[selectedIssue.issue_type]} text-white`}>
                    {selectedIssue.issue_type}
                  </span>
                </div>
                <button
                  onClick={handleCloseDetail}
                  className="text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              </div>
              <div className="p-4 overflow-y-auto flex-1">
                <h3 className="text-lg font-semibold mb-4">{selectedIssue.title}</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Status</span>
                    <span className={`px-2 py-0.5 rounded ${STATUS_COLORS[selectedIssue.status] || 'bg-gray-500'} text-white text-xs`}>
                      {STATUS_LABELS[selectedIssue.status] || selectedIssue.status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Type</span>
                    <span>{selectedIssue.issue_type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Owner</span>
                    <span>{selectedIssue.owner || selectedIssue.created_by}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Created</span>
                    <span>{new Date(selectedIssue.created_at).toLocaleDateString()}</span>
                  </div>
                  
                  {/* Dependencies */}
                  {selectedIssueDeps.length > 0 && (
                    <div className="pt-2 border-t border-gray-700">
                      <span className="text-gray-400 text-xs uppercase">Dependencies</span>
                      <div className="mt-2 space-y-1">
                        {selectedIssueDeps.map((dep, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs bg-gray-900 px-2 py-1 rounded">
                            <span className="text-gray-400">{dep.id}</span>
                            <span className={`px-1 rounded ${dep.dependency_type === 'blocks' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'}`}>
                              {dep.dependency_type}
                            </span>
                            <span className="truncate">{dep.title}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Children for Epics */}
                  {selectedIssue.issue_type === 'epic' && selectedIssueChildren.length > 0 && (
                    <div className="pt-2 border-t border-gray-700">
                      <span className="text-gray-400 text-xs uppercase">Children ({selectedIssueChildren.length})</span>
                      <div className="mt-2 space-y-1">
                        {selectedIssueChildren.map((child) => (
                          <button
                            key={child.id}
                            onClick={() => handleIssueClick(child)}
                            className="w-full flex items-center gap-2 text-xs bg-gray-900 px-2 py-1 rounded hover:bg-gray-700"
                          >
                            <span className={`w-2 h-2 rounded-full ${STATUS_COLORS[child.status]}`} />
                            <span className="font-mono text-gray-400">{child.id}</span>
                            <span className="truncate">{child.title}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-4 border-t border-gray-700 flex gap-2">
                {selectedIssue.status === 'open' && (
                  <button
                    onClick={() => handleStatusChange(selectedIssue.id, 'in_progress')}
                    className="flex-1 bg-yellow-600 hover:bg-yellow-700 px-3 py-2 rounded text-sm"
                  >
                    Start Work
                  </button>
                )}
                {selectedIssue.status === 'in_progress' && (
                  <button
                    onClick={() => handleStatusChange(selectedIssue.id, 'done')}
                    className="flex-1 bg-green-600 hover:bg-green-700 px-3 py-2 rounded text-sm"
                  >
                    Complete
                  </button>
                )}
                <button
                  onClick={handleCloseDetail}
                  className="flex-1 border border-gray-600 hover:bg-gray-700 px-3 py-2 rounded text-sm"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
