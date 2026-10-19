import type { SessionWithProvider } from '@/shared/types';

type TreeNode = {
  session: SessionWithProvider;
  parentId: string | null;
  children: TreeNode[];
  rank: number;
};

/**
 * SidebarProjectSessions alone uses this projection. Keep the shared session
 * list flat so Conversations, search and pagination retain their own ordering.
 * The input is newest first; a family's newest descendant determines its
 * position, and parents always precede children. Ancestor hints fill page gaps,
 * while actual page rows take precedence over their older context snapshots.
 */
export function buildProjectSessionTree(sessions: SessionWithProvider[], projectId: string) {
  const nodes = new Map<string, TreeNode>();
  sessions.forEach((session, rank) => {
    if (!nodes.has(session.id)) {
      nodes.set(session.id, { session, parentId: null, children: [], rank });
    }
  });

  const hints = new Map(sessions.flatMap((session) => session.forkAncestors ?? []).map((ancestor) => [ancestor.id, ancestor]));
  for (const session of sessions) {
    let child = session;
    const visited = new Set([child.id]);
    while (child.forkedFromSessionId && !visited.has(child.forkedFromSessionId)) {
      const parentId = child.forkedFromSessionId;
      visited.add(parentId);
      const existing = nodes.get(parentId);
      // Existing nodes already have their own ancestry pass. In particular,
      // walking every loaded chain again would make deep trees quadratic.
      if (existing) break;
      const hint = hints.get(parentId);
      const parent = hint ? {
        ...hint,
        __provider: hint.__provider ?? hint.provider ?? session.__provider,
        __projectId: projectId,
      } : null;
      if (!parent || parent.__provider !== session.__provider) break;
      nodes.set(parentId, { session: parent, parentId: null, children: [], rank: Infinity });
      child = parent;
    }
  }

  for (const node of nodes.values()) {
    const parent = nodes.get(node.session.forkedFromSessionId ?? '');
    if (parent && parent !== node && parent.session.__provider === node.session.__provider) {
      node.parentId = parent.session.id;
    }
  }

  // Sever one edge per cycle, without recursion or dropping any session.
  const checked = new Set<string>();
  for (const node of nodes.values()) {
    const path = new Set<string>();
    let current: TreeNode | undefined = node;
    while (current && !checked.has(current.session.id)) {
      path.add(current.session.id);
      if (current.parentId && path.has(current.parentId)) {
        current.parentId = null;
        break;
      }
      current = current.parentId ? nodes.get(current.parentId) : undefined;
    }
    for (const id of path) checked.add(id);
  }

  const roots: TreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Post-order gives each family the rank of its newest paginated member.
  const pending = [...roots];
  const traversal: TreeNode[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    traversal.push(node);
    pending.push(...node.children);
  }
  for (let index = traversal.length - 1; index >= 0; index -= 1) {
    const node = traversal[index];
    if (node.parentId) {
      const parent = nodes.get(node.parentId)!;
      parent.rank = Math.min(parent.rank, node.rank);
    }
    node.children.sort((a, b) => a.rank - b.rank);
  }
  roots.sort((a, b) => a.rank - b.rank);

  const rows: { session: SessionWithProvider; parentId: string | null; depth: number; hasChildren: boolean; isLastSibling: boolean }[] = [];
  const stack = roots.map((node, index) => ({ node, depth: 0, isLastSibling: index === roots.length - 1 })).reverse();
  while (stack.length) {
    const { node, depth, isLastSibling } = stack.pop()!;
    rows.push({ session: node.session, parentId: node.parentId, depth, hasChildren: node.children.length > 0, isLastSibling });
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children[index], depth: depth + 1, isLastSibling: index === node.children.length - 1 });
    }
  }
  return rows;
}
