import type { ChatMessage, SubagentChildTool, ToolResult } from '../types/types';
import type { TodoItem } from '../tools/components/ContentRenderers/TodoList';

export type AgentTodoSummary = {
  id: string;
  label: string;
  todos: TodoItem[];
  activeTodo: string;
  completedCount: number;
  pendingCount: number;
  inProgressCount: number;
  updatedAt: Date;
};

type TodoTool = Pick<ChatMessage, 'toolName' | 'toolInput' | 'toolResult' | 'timestamp'>;

const TODO_TOOL_NAMES = new Set(['TodoWrite', 'TodoRead', 'TodoList']);

export function deriveAgentTodoSummaries(messages: ChatMessage[]): AgentTodoSummary[] {
  let mainSummary: AgentTodoSummary | null = null;
  const subagentSummaries = new Map<string, AgentTodoSummary>();

  for (const message of messages) {
    const mainTodos = getToolTodos(message);
    if (mainTodos) {
      mainSummary = buildSummary('agent', 'Agent', mainTodos, toUpdatedAt(message.timestamp));
    }

    const childTools = message.subagentState?.childTools ?? [];
    for (const childTool of childTools) {
      const childTodos = getToolTodos(childTool);
      if (!childTodos) continue;

      const id = `subagent:${String(message.toolId ?? message.toolCallId ?? message.timestamp)}`;
      subagentSummaries.set(
        id,
        buildSummary(
          id,
          getSubagentLabel(message),
          childTodos,
          toUpdatedAt(childTool.timestamp),
        ),
      );
    }
  }

  return [...subagentSummaries.values(), ...(mainSummary ? [mainSummary] : [])].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

function buildSummary(
  id: string,
  label: string,
  todos: TodoItem[],
  updatedAt: Date,
): AgentTodoSummary {
  const completedCount = todos.filter((todo) => todo.status === 'completed').length;
  const pendingCount = todos.filter((todo) => todo.status === 'pending').length;
  const inProgressCount = todos.filter((todo) => todo.status === 'in_progress').length;

  return {
    id,
    label,
    todos,
    activeTodo:
      todos.find((todo) => todo.status === 'in_progress')?.content ??
      todos.find((todo) => todo.status !== 'completed')?.content ??
      '',
    completedCount,
    pendingCount,
    inProgressCount,
    updatedAt,
  };
}

function getToolTodos(tool: TodoTool | SubagentChildTool): TodoItem[] | null {
  if (!tool.toolName || !TODO_TOOL_NAMES.has(tool.toolName)) return null;

  if (tool.toolName === 'TodoRead') {
    return normalizeTodos(parseTodoReadResult(tool.toolResult));
  }

  const input = parseMaybeJson(tool.toolInput);
  if (!isRecord(input)) return null;

  const rawTodos = tool.toolName === 'TodoList' ? input.items ?? input.todos : input.todos;
  return normalizeTodos(rawTodos);
}

function parseTodoReadResult(result: ToolResult | null | undefined): unknown {
  const content = result?.content;
  if (Array.isArray(content)) return content;
  if (typeof content !== 'string') return null;

  const trimmed = content.trim();
  if (!trimmed.startsWith('[')) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function normalizeTodos(value: unknown): TodoItem[] | null {
  if (!Array.isArray(value)) return null;

  const todos = value.flatMap((item) => {
    const todo = normalizeTodo(item);
    return todo ? [todo] : [];
  });

  return todos.length > 0 ? todos : null;
}

function normalizeTodo(value: unknown): TodoItem | null {
  if (!isRecord(value)) return null;

  const content = firstString(value.content, value.text, value.title);
  if (!content) return null;

  const todo: TodoItem = {
    content,
    status: normalizeStatus(value.status, value.completed),
  };

  if (typeof value.id === 'string') todo.id = value.id;
  if (typeof value.priority === 'string') todo.priority = value.priority;
  if (typeof value.activeForm === 'string') todo.activeForm = value.activeForm;

  return todo;
}

function normalizeStatus(status: unknown, completed: unknown): TodoItem['status'] {
  if (typeof status === 'string') {
    const normalized = status.toLowerCase().replace(/-/g, '_');
    if (normalized === 'completed' || normalized === 'in_progress' || normalized === 'pending') {
      return normalized;
    }
  }

  return completed === true ? 'completed' : 'pending';
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function getSubagentLabel(message: ChatMessage): string {
  const input = parseMaybeJson(message.toolInput);
  if (!isRecord(input)) return 'Subagent';

  const label = firstString(input.subagent_type, input.description);
  return label ?? 'Subagent';
}

function firstString(...values: unknown[]): string | null {
  const value = values.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  return typeof value === 'string' ? value : null;
}

function toUpdatedAt(value: ChatMessage['timestamp']): Date {
  return value instanceof Date ? value : new Date(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
