import React from 'react';

interface TaskItem {
  id: string;
  subject: string;
  status: 'pending' | 'in_progress' | 'completed';
  owner?: string;
  blockedBy?: string[];
}

interface TaskListContentProps {
  content: string;
}

function parseTaskContent(content: string): TaskItem[] {
  const tasks: TaskItem[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match patterns like: #15. [in_progress] Subject here
    // or: - #15 [in_progress] Subject (owner: agent)
    // or: #15. Subject here (status: in_progress)
    const match = line.match(/#(\d+)\.?\s*(?:\[(\w+)\]\s*)?(.+?)(?:\s*\((?:owner:\s*\w+)?\))?$/);
    if (match) {
      const [, id, status, subject] = match;
      const blockedMatch = line.match(/blockedBy:\s*\[([^\]]*)\]/);
      tasks.push({
        id,
        subject: subject.trim(),
        status: (status as TaskItem['status']) || 'pending',
        blockedBy: blockedMatch ? blockedMatch[1].split(',').map(s => s.trim()).filter(Boolean) : undefined
      });
    }
  }

  return tasks;
}

const statusConfig = {
  completed: {
    icon: (
      <svg className="w-3.5 h-3.5 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    textClass: 'line-through text-gray-400 dark:text-gray-500',
    badgeClass: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800'
  },
  in_progress: {
    icon: (
      <svg className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    textClass: 'text-gray-900 dark:text-gray-100',
    badgeClass: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
  },
  pending: {
    icon: (
      <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" strokeWidth={2} />
      </svg>
    ),
    textClass: 'text-gray-700 dark:text-gray-300',
    badgeClass: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700'
  }
};

/**
 * Renders task list results with proper status icons and compact layout
 * Parses text content from TaskList/TaskGet results
 */
export const TaskListContent: React.FC<TaskListContentProps> = ({ content }) => {
  const tasks = parseTaskContent(content);

  // If we couldn't parse any tasks, fall back to text display
  if (tasks.length === 0) {
    return (
      <pre className="text-[11px] font-mono text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
        {content}
      </pre>
    );
  }

  const completed = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {completed}/{total} completed
        </span>
        <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 dark:bg-green-400 rounded-full transition-all"
            style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
          />
        </div>
      </div>
      <div className="space-y-px">
        {tasks.map((task) => {
          const config = statusConfig[task.status] || statusConfig.pending;
          return (
            <div
              key={task.id}
              className="flex items-center gap-1.5 py-0.5 group"
            >
              <span className="flex-shrink-0">{config.icon}</span>
              <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500 flex-shrink-0">
                #{task.id}
              </span>
              <span className={`text-xs truncate flex-1 ${config.textClass}`}>
                {task.subject}
              </span>
              <span className={`text-[10px] px-1 py-px rounded border flex-shrink-0 ${config.badgeClass}`}>
                {task.status.replace('_', ' ')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
